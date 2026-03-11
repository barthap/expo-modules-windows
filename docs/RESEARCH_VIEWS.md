# Native View Components — Research

> Compiled from research agents studying Expo Modules Core (iOS/Android) and
> React Native Windows Fabric view implementation.

---

## Part 1: How RNW Fabric Views Work

### Architecture: Composition Visuals, Not XAML

In RNW's New Architecture, Fabric views are **WinUI 3 Composition visuals**
(`Microsoft.UI.Composition.Visual`). XAML controls are NOT used by default.

Each component has:
- `m_outerVisual` — container/parent mount point
- `m_visual` — the actual rendered visual
- Border primitives, shadows, focus visuals as child visuals

### Component View Hierarchy

```
ComponentView (base)
  └── CompositionViewComponentView (composition support)
      └── ViewComponentView (standard view - supports children)
          └── Specific implementations (Switch, Image, etc.)
```

### Builder Pattern (How Custom Views Register)

RNW uses `IReactCompositionViewComponentBuilder`:

```cpp
// Handlers set on the builder:
CreateVisualHandler     — factory returning a Visual
UpdatePropsHandler      — applies prop changes
MountChildComponentViewHandler — child management
```

Registration:
```cpp
WindowsComponentDescriptorRegistry::Add(componentName, provider) {
    auto builder = make<ReactCompositionViewComponentBuilder>();
    provider(builder);  // User sets handlers on builder
    m_componentDescriptorRegistry->add({handle, name, builder->GetComponentDescriptorProvider()});
}
```

### Props Pipeline

1. Fabric ShadowNode receives React prop updates
2. `ConcreteAbiViewComponentDescriptor` parses via `cloneProps()` → `AbiViewProps`
3. `ComponentView::updateProps()` called with new/old props
4. Builder's `UpdatePropsHandler` invoked

### Visual Creation

```cpp
void ViewComponentView::ensureVisual() {
    if (!m_visual) {
        if (m_builder && m_builder->CreateVisualHandler()) {
            m_visual = m_builder->CreateVisualHandler()(*this);  // Custom
        } else {
            m_visual = createVisual();  // Default: SpriteVisual
        }
        OuterVisual().InsertAt(m_visual, 0);
    }
}
```

### XAML Hosting via ContentIsland

XAML controls CAN be hosted inside Composition via `ContentIslandComponentView`:

```cpp
runtimeclass ContentIslandComponentView : ViewComponentView {
    void Connect(Microsoft.UI.Content.ContentIsland contentIsland);
};
```

This bridges WinUI 3 XAML with Composition, but is not the default path.

### Layout

Yoga calculates layout → `updateLayoutMetrics()` positions the visual:

```cpp
OuterVisual().Size({width * scale, height * scale});
OuterVisual().Offset({x * scale, y * scale, 0.0f});
```

### Component Feature Flags

```cpp
enum ComponentViewFeatures {
    NativeBorder  = 0x01,
    ShadowProps   = 0x02,
    Background    = 0x04,
    FocusVisual   = 0x08,
    Default       = 0x0F,  // All enabled
};
```

### Key Source Files

- `Microsoft.ReactNative/Fabric/ComponentView.h`
- `Microsoft.ReactNative/Fabric/Composition/CompositionViewComponentView.h/.cpp`
- `Microsoft.ReactNative/Fabric/Composition/ReactCompositionViewComponentBuilder.h`
- `Microsoft.ReactNative/Fabric/AbiViewComponentDescriptor.h`
- `Microsoft.ReactNative/Fabric/WindowsComponentDescriptorRegistry.h`
- `Microsoft.ReactNative/CompositionComponentView.idl`
- `Microsoft.ReactNative/IReactCompositionViewComponentBuilder.idl`

---

## Part 2: How Expo Modules Core Views Work (iOS/Android)

### View DSL Components

| Component | Purpose |
|-----------|---------|
| `View(ViewClass)` | Register a native view type |
| `Prop(name, setter)` | Property setter (type-safe) |
| `Events("name1", ...)` | Declare emittable events |
| `OnViewDestroys(cb)` | Cleanup when view is recycled |
| `OnViewDidUpdateProps(cb)` | After prop batch applied |
| `AsyncFunction(name, cb)` | Imperative command (receives view) |
| `GroupView { ... }` | Child management (AddChild, RemoveChild) |

### Prop System

Props flow: JS value → TypeConverter → typed setter lambda

```kotlin
// Android
Prop("source") { view: ImageView, source: List<SourceMap> ->
    view.setSource(source)
}

// iOS
Prop("colors") { (view: GradientView, colors: [UIColor]) in
    view.setColors(colors)
}
```

### View Factory

Constructor resolution order:
1. `MyView(context, appContext)` — preferred (access to events, modules)
2. `MyView(context)` — fallback
3. Error if neither exists

### Event System

```kotlin
// Definition
Events("onChange", "onLoadComplete")

// Emission (from view code)
sendEvent("onChange", mapOf("value" to 42))
```

Events can fire from any thread → marshaled to JS thread.

### Commands (Imperative Methods)

```kotlin
View(VideoView::class) {
    AsyncFunction("enterFullscreen") { view: VideoView ->
        view.enterFullscreen()
    }
}
```

JS: `videoRef.current?.enterFullscreen()`

### GroupView (Children)

```kotlin
GroupView {
    AddChildView { parent, child, index -> parent.addView(child, index) }
    RemoveChildView { parent, child -> parent.removeView(child) }
    GetChildCount { parent -> parent.childCount }
    GetChildViewAt { parent, index -> parent.getChildAt(index) }
}
```

### Platform View Base Classes

| Platform | Base Class | Extends |
|----------|-----------|---------|
| Android | `ExpoView` | `LinearLayout` |
| iOS (UIKit) | `ExpoView` (alias for `ExpoFabricView`) | `UIView` |
| iOS (SwiftUI) | Wrapped in `SwiftUIViewHost` | `UIHostingController` |
| Android (Compose) | Wrapped in `ExpoComposeView` | `ComposeView` |

### UIKit + SwiftUI Dual Support (iOS)

```swift
// Unified enum
public enum AppleView: Sendable {
    case uikit(UIView)
    case swiftui(any ExpoSwiftUI.View)
}
```

SwiftUI views are hosted inside UIKit via `UIHostingController`.
UIKit views can be wrapped in SwiftUI via `UIViewRepresentable`.

### Fabric Integration

- Android: `AndroidExpoViewComponentDescriptor` wraps Expo views as Fabric components
- iOS: `ExpoFabricView` implements `RCTFabricComponentViewProtocol`
- Runtime class generation on iOS: `objc_allocateClassPair(ExpoFabricView.self, "Expo_\(viewName)", 0)`

### Threading

- **Props**: Applied on UI/main thread
- **Events**: Can fire from any thread, marshaled to JS
- **Commands**: Background thread by default, can specify main thread
- **Lifecycle**: React Native thread (Android), main thread (iOS)

---

## Part 3: Design Implications for Windows

### The Two-Layer Architecture

Like iOS supports both UIKit (default) and SwiftUI (hosted), Windows should support:

1. **XAML/WinUI 3 controls** (default, high-level DX)
   - Module authors create `UserControl`, `Grid`, `Canvas`, etc.
   - Hosted inside Composition via `ContentIsland`
   - Analogous to UIKit on iOS

2. **Composition visuals** (low-level, for custom rendering)
   - Direct `SpriteVisual`, `ShapeVisual`, etc.
   - No XAML overhead
   - Analogous to CoreAnimation/Metal on iOS

### Bridge Mechanism

```
C# View (XAML or custom)
  → ContentIsland (if XAML) or direct Visual (if Composition)
    → RNW's ComponentView (Fabric)
      → Yoga layout
        → Screen
```

### Key Questions for Design

1. How does C# create and return a Visual/XAML element to C++?
2. How do props flow from C++ (Fabric) → C# (view setter)?
3. How do view events flow from C# → C++ → JS?
4. How does the C# view integrate with Yoga layout?
5. Can we avoid codegen for the C++ Fabric component descriptor?
