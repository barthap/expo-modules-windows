# Native View Components — Design Document

> Extends the Expo Modules Windows Core to support native view components
> (Fabric views) authored in C# using the Expo View DSL.

---

## Goals

1. Module authors write C# views using XAML/WinUI 3 controls (default) or Composition visuals (escape hatch)
2. Views register via the same DSL pattern as functions/events: `View<T>()`, `Prop()`, `Events()`, `GroupView()`
3. Views integrate with RNW's Fabric pipeline — no custom codegen needed
4. Props flow from JS → C++ (Fabric) → C# (typed setter)
5. Events flow from C# → C++ → JS
6. Layout is driven by Yoga (React Native), not XAML layout

---

## Architecture Overview

```
JS Component
  │
  ├── React.createElement("ExpoMyView", { color: "red" })
  │
  ▼
Fabric ShadowNode (C++)
  │  ← RNW's IReactCompositionViewComponentBuilder
  │     registers CreateVisualHandler, UpdatePropsHandler, etc.
  │
  ├── Yoga calculates layout → updateLayoutMetrics()
  │
  ▼
ExpoViewManager (C++) — one per view type
  │  ← Registered via WindowsComponentDescriptorRegistry::Add()
  │  ← Holds a ViewDefinition (parsed from C# manifest)
  │
  ├── CreateVisual → calls C# Expo_CreateView(viewTypeIndex) → returns Visual
  ├── UpdateProps  → calls C# Expo_UpdateViewProps(viewId, propsJson)
  ├── MountChild   → calls C# Expo_MountChild(viewId, childViewId, index)
  └── UnmountChild → calls C# Expo_UnmountChild(viewId, childViewId, index)
  │
  ▼
C# View Instance (XAML UserControl or Composition Visual)
  ← Created by factory in ViewDefinition
  ← Props applied via typed setters
  ← Hosted in Composition tree via ContentIsland (XAML) or direct visual (Composition)
```

---

## C# View DSL

### Module Author API

```csharp
public class MyMapModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("MyMap"),

        // View registration — ties a C# view class to a React component
        View<MapView>(() => new MapView(), view => new ViewDefinition
        {
            Prop<string>("region", (v, region) => v.SetRegion(region)),
            Prop<double>("zoomLevel", (v, zoom) => v.ZoomLevel = zoom),
            Prop<bool>("showsUserLocation", (v, show) => v.ShowUserLocation(show)),

            Events("onRegionChange", "onMarkerPress"),

            OnViewDidUpdateProps((v) => v.CommitPropChanges()),
        }),

        // Module-level functions still work alongside views
        Function<string>("getMapStyle", () => "standard"),
    };
}
```

### MapView (XAML — default path)

```csharp
using Microsoft.UI.Xaml.Controls;

public class MapView : UserControl, IExpoView
{
    private readonly MapControl _map = new();

    public MapView()
    {
        Content = _map;
    }

    public void SetRegion(string region) { /* ... */ }
    public double ZoomLevel { get => _map.ZoomLevel; set => _map.ZoomLevel = value; }
    public void ShowUserLocation(bool show) { /* ... */ }
    public void CommitPropChanges() { /* batch commit */ }

    // IExpoView — required for event emission
    public Action<string, object?>? SendEvent { get; set; }

    // Raise events to JS
    public void OnRegionChanged(MapRegion region)
    {
        SendEvent?.Invoke("onRegionChange", new { latitude = region.Lat, longitude = region.Lon });
    }
}
```

### Alternative: Composition Visual (low-level)

```csharp
using Microsoft.UI.Composition;

public class CustomDrawView : IExpoCompositionView
{
    private SpriteVisual? _visual;

    public Visual CreateVisual(Compositor compositor)
    {
        _visual = compositor.CreateSpriteVisual();
        _visual.Brush = compositor.CreateColorBrush(Windows.UI.Colors.Red);
        return _visual;
    }

    public Action<string, object?>? SendEvent { get; set; }
}
```

---

## Core Types (C# — Expo.Modules.Core)

### IExpoView

```csharp
/// <summary>
/// Marker interface for XAML-based views. The view must be a FrameworkElement
/// (UserControl, Grid, Canvas, etc.). Hosted inside Fabric via ContentIsland.
/// </summary>
public interface IExpoView
{
    /// <summary>
    /// Set by the framework before props are applied.
    /// Call this to emit events to JS: SendEvent("onPress", new { x = 10, y = 20 })
    /// </summary>
    Action<string, object?>? SendEvent { get; set; }
}
```

### IExpoCompositionView

```csharp
/// <summary>
/// Interface for low-level Composition visual views.
/// Use when XAML overhead is unnecessary (custom drawing, animations).
/// </summary>
public interface IExpoCompositionView
{
    /// <summary>
    /// Called once to create the visual. The returned Visual is inserted
    /// into the Fabric composition tree directly (no ContentIsland).
    /// </summary>
    Visual CreateVisual(Compositor compositor);

    Action<string, object?>? SendEvent { get; set; }
}
```

### ViewDefinition

```csharp
public class ViewDefinition : IEnumerable
{
    internal string? ViewName { get; set; }
    internal List<PropDescriptor> Props { get; } = new();
    internal List<string> EventNames { get; } = new();
    internal Action<object>? OnViewDidUpdatePropsCallback { get; set; }
    internal Action<object>? OnViewDestroysCallback { get; set; }

    // GroupView support
    internal bool IsGroupView { get; set; }
    internal Action<object, object, int>? AddChildHandler { get; set; }
    internal Action<object, object, int>? RemoveChildHandler { get; set; }

    public void Add(IViewDefinitionComponent component) => component.Apply(this);
    IEnumerator IEnumerable.GetEnumerator() => throw new NotSupportedException();
}

public interface IViewDefinitionComponent
{
    void Apply(ViewDefinition definition);
}
```

### PropDescriptor

```csharp
public class PropDescriptor
{
    public string Name { get; }
    public Type ValueType { get; }
    internal Action<object, object?> Setter { get; }

    public PropDescriptor(string name, Type valueType, Action<object, object?> setter)
    {
        Name = name;
        ValueType = valueType;
        Setter = setter;
    }
}
```

### View DSL Components

```csharp
// In Module.cs — protected static helpers

protected static IDefinitionComponent View<TView>(
    Func<TView> factory,
    Func<TView, ViewDefinition> configure) where TView : class
{
    return new ViewComponent(typeof(TView), () =>
    {
        var view = factory();
        var def = configure(view);
        return (view, def);
    });
}

// Prop<T> helper — used inside ViewDefinition initializer
public static IViewDefinitionComponent Prop<TValue>(
    string name, Action<TView, TValue> setter)
{
    return new PropComponent(name, typeof(TValue), (view, val) =>
        setter((TView)view, (TValue)TypeConverter.ConvertTo(val, typeof(TValue))!));
}

// Events (reuses string list)
public static IViewDefinitionComponent Events(params string[] names)
    => new ViewEventsComponent(names);

// Lifecycle
public static IViewDefinitionComponent OnViewDidUpdateProps<TView>(Action<TView> callback)
    => new ViewLifecycleComponent(def => def.OnViewDidUpdatePropsCallback = v => callback((TView)v));

public static IViewDefinitionComponent OnViewDestroys<TView>(Action<TView> callback)
    => new ViewLifecycleComponent(def => def.OnViewDestroysCallback = v => callback((TView)v));

// GroupView
public static IViewDefinitionComponent GroupView(
    Action<object, object, int>? addChild = null,
    Action<object, object, int>? removeChild = null)
{
    return new GroupViewComponent(addChild, removeChild);
}
```

### ModuleDefinition Changes

```csharp
// Added to ModuleDefinition:
internal ViewRegistration? ViewRegistration { get; set; }

internal class ViewRegistration
{
    public Type ViewType { get; init; }
    public Func<(object view, ViewDefinition def)> Factory { get; init; }
}
```

---

## C++ ↔ C# Interop for Views

### New C# Entry Points (NativeEntryPoints.cs)

```csharp
// ---- View Management ----

[UnmanagedCallersOnly(EntryPoint = "Expo_CreateView")]
public static unsafe int Expo_CreateView(
    int moduleIdx,        // which module owns this view type
    int* outViewId)       // returns a unique view instance ID
{
    // 1. Get module's ViewRegistration
    // 2. Call factory to create view instance
    // 3. Create ViewDefinition, wire up SendEvent callback
    // 4. Store in ViewRegistry under new viewId
    // 5. Return viewId
}

[UnmanagedCallersOnly(EntryPoint = "Expo_DestroyView")]
public static unsafe void Expo_DestroyView(int viewId)
{
    // 1. Call OnViewDestroys callback
    // 2. Remove from ViewRegistry
    // 3. Dispose if IDisposable
}

[UnmanagedCallersOnly(EntryPoint = "Expo_UpdateViewProps")]
public static unsafe int Expo_UpdateViewProps(
    int viewId,
    byte* propsJson, int propsLen)
{
    // 1. Deserialize propsJson as Dictionary<string, JsonElement>
    // 2. For each key, find PropDescriptor by name
    // 3. Deserialize value to prop's ValueType via TypeConverter
    // 4. Call setter(view, typedValue)
    // 5. Call OnViewDidUpdateProps if set
}

[UnmanagedCallersOnly(EntryPoint = "Expo_GetViewVisualInfo")]
public static unsafe int Expo_GetViewVisualInfo(
    int viewId,
    byte** outJson, int* outLen)
{
    // Returns: { "type": "xaml" | "composition", "hwnd": ... }
    // For XAML views: C++ uses ContentIsland to host the XAML element
    // For Composition views: already created, C++ retrieves via IInspectable
}

// GroupView child management
[UnmanagedCallersOnly(EntryPoint = "Expo_MountChildView")]
public static unsafe void Expo_MountChildView(int parentViewId, int childViewId, int index);

[UnmanagedCallersOnly(EntryPoint = "Expo_UnmountChildView")]
public static unsafe void Expo_UnmountChildView(int parentViewId, int childViewId, int index);
```

### View Event Routing

View events use the same event callback mechanism as module events, but include
a `viewId` field for routing:

```csharp
// In the view's SendEvent delegate:
SendEvent = (name, data) =>
{
    var payload = new { viewId, moduleIndex, name, data };
    // Same callback path as Module.SendEvent
};
```

On the C++ side, the event handler checks for `viewId` and dispatches to the
correct Fabric `ComponentView`'s event emitter.

### XAML ↔ Composition Bridge

The key challenge: C# creates a XAML `FrameworkElement`, but RNW's Fabric tree
uses `Microsoft.UI.Composition.Visual`. The bridge is `ContentIsland`.

```
C# creates: UserControl (XAML FrameworkElement)
    ↓
C++ creates ContentIsland from the XAML element
    ↓
ContentIslandComponentView hosts it in the Fabric Composition tree
    ↓
Yoga layout → sets size/position on the outer Visual
```

**Important**: The `ContentIsland` bridge is created on the C++ side using the
WinRT interop. C# simply returns the view object as an `IInspectable` (COM
interface), and C++ wraps it.

For Composition views, no bridge is needed — C# returns a `Visual` directly.

### Object Passing: IInspectable Handle

C# XAML controls (`FrameworkElement`) and Composition `Visual` objects are WinRT
types. They can be passed across the C++/C# boundary as `IInspectable*` pointers:

```csharp
// C# side: return the view as an IntPtr (IInspectable*)
[UnmanagedCallersOnly(EntryPoint = "Expo_GetViewObject")]
public static unsafe IntPtr Expo_GetViewObject(int viewId)
{
    var view = ViewRegistry.Get(viewId);

    // For XAML views: view.Instance is a FrameworkElement (WinRT type)
    // For Composition views: view.CompositionVisual is a Visual (WinRT type)
    object winrtObj = view.IsComposition ? view.CompositionVisual! : view.Instance;

    // Marshal WinRT object to IInspectable*
    return Marshal.GetIUnknownForObject(winrtObj);
    // C++ side must Release() after use
}
```

```cpp
// C++ side: receive IInspectable and use it
winrt::Windows::Foundation::IInspectable inspectable;
winrt::attach_abi(inspectable, pInspectable);  // takes ownership

if (isXaml) {
    auto element = inspectable.as<winrt::Microsoft::UI::Xaml::FrameworkElement>();
    // Create ContentIsland and connect to ComponentView
} else {
    auto visual = inspectable.as<winrt::Microsoft::UI::Composition::Visual>();
    // Use directly as the ComponentView's visual
}
```

---

## C++ View Registration (ExpoViewManager)

### Registration with RNW

Each view type from C# modules registers as a Fabric component via
`WindowsComponentDescriptorRegistry`:

```cpp
// In ReactPackageProvider or during module initialization:
void RegisterExpoViews(IReactPackageBuilder const& packageBuilder) {
    auto& host = ExpoModuleHost::Instance();

    for (const auto& viewInfo : host.GetViewInfos()) {
        // Register with Fabric
        packageBuilder.as<IReactPackageBuilderFabric>()
            .AddViewComponent(viewInfo.componentName,
                [&host, viewInfo](IReactCompositionViewComponentBuilder const& builder) {

            builder.SetCreateVisualHandler([&host, viewInfo](
                IReactCompositionViewComponentView const& view) -> Visual {
                // Call C# to create the view instance
                int viewId = -1;
                host.CreateView(viewInfo.moduleIndex, &viewId);
                // Store viewId on the ComponentView's tag
                // Get the visual (XAML ContentIsland or Composition Visual)
                return host.GetViewVisual(viewId, view.Compositor());
            });

            builder.SetUpdatePropsHandler([&host](
                IReactCompositionViewComponentView const& view,
                IComponentProps const& newProps,
                IComponentProps const& oldProps) {
                int viewId = GetViewIdFromTag(view);
                auto propsJson = SerializeChangedProps(newProps, oldProps);
                host.UpdateViewProps(viewId, propsJson);
            });

            // Mount/unmount children (GroupView only)
            if (viewInfo.isGroupView) {
                builder.SetMountChildComponentViewHandler(...);
                builder.SetUnmountChildComponentViewHandler(...);
            }
        });
    }
}
```

### Props Serialization

RNW's Fabric pipeline delivers props as `AbiViewProps` (a `folly::dynamic` map).
The C++ layer serializes changed props to JSON and sends them to C#:

```cpp
std::string SerializeChangedProps(
    const IComponentProps& newProps,
    const IComponentProps& oldProps)
{
    // Compare newProps vs oldProps
    // Serialize only changed keys to JSON: {"color":"red","opacity":0.5}
    // This matches Expo's pattern — props come as a batch
}
```

This reuses the existing `ExpoMarshal` JSON serialization.

### Layout Integration

Yoga calculates layout. RNW applies layout via `updateLayoutMetrics()` which
sets `OuterVisual().Size()` and `OuterVisual().Offset()`. This happens
automatically — no C# involvement needed.

For XAML views hosted via ContentIsland, the ContentIsland's size is updated
to match Yoga's layout output. The XAML element stretches to fill.

---

## Module Manifest Extension

The manifest returned by `Expo_GetModuleDefinitions` gains a `view` field:

```json
{
  "name": "MyMap",
  "syncFunctions": ["getMapStyle"],
  "asyncFunctions": [],
  "constants": {},
  "events": [],
  "view": {
    "componentName": "ExpoMyMap",
    "props": [
      { "name": "region", "type": "string" },
      { "name": "zoomLevel", "type": "number" },
      { "name": "showsUserLocation", "type": "boolean" }
    ],
    "events": ["onRegionChange", "onMarkerPress"],
    "isGroupView": false
  }
}
```

The C++ host uses this to:
1. Register the Fabric component with `componentName`
2. Know which props to forward
3. Set up event emitters
4. Enable/disable child management

### Component Naming Convention

Following Expo's convention: `Expo` + module name → `ExpoMyMap`, `ExpoCamera`, etc.
This matches `AndroidExpoViewComponentDescriptor` / `ExpoFabricView` naming on other platforms.

---

## ViewRegistry (C#)

Manages live view instances, separate from ModuleRegistry:

```csharp
internal class ViewRegistry
{
    private int _nextId = 1;
    private readonly Dictionary<int, ViewInstance> _views = new();

    public int CreateView(ViewRegistration registration)
    {
        var (view, definition) = registration.Factory();
        int id = _nextId++;

        var instance = new ViewInstance
        {
            Id = id,
            View = view,
            Definition = definition,
            IsComposition = view is IExpoCompositionView,
        };

        // Wire up SendEvent
        if (view is IExpoView expoView)
            expoView.SendEvent = (name, data) => EmitViewEvent(id, name, data);
        else if (view is IExpoCompositionView compView)
            compView.SendEvent = (name, data) => EmitViewEvent(id, name, data);

        _views[id] = instance;
        return id;
    }

    public void DestroyView(int id) { ... }
    public ViewInstance Get(int id) => _views[id];
}

internal class ViewInstance
{
    public int Id { get; init; }
    public object View { get; init; }       // The C# view (FrameworkElement or IExpoCompositionView)
    public ViewDefinition Definition { get; init; }
    public bool IsComposition { get; init; }
    public Visual? CompositionVisual { get; set; }  // Set after CreateVisual()
}
```

---

## JS Side

### requireNativeViewManager

Expo's JS side uses `requireNativeViewManager(viewName)` which resolves to a
Fabric native component. On Windows, this maps to the registered
`componentName` (e.g., `"ExpoMyMap"`).

The existing `src/` TypeScript code already handles this pattern. No changes
needed to the JS module spec — views are registered as native components
through RNW's standard Fabric path, not through the JSI HostObject.

### Commands (Imperative Methods)

Commands like `ref.current.takePicture()` are dispatched via React Native's
`UIManager.dispatchViewManagerCommand()`. On Windows Fabric, these become
`handleCommand()` calls on the ComponentView.

The C++ `ExpoViewManager` forwards commands to C# via a new entry point:

```csharp
[UnmanagedCallersOnly(EntryPoint = "Expo_DispatchViewCommand")]
public static unsafe int Expo_DispatchViewCommand(
    int viewId,
    byte* commandName, int commandNameLen,
    byte* argsJson, int argsLen,
    byte** resultJson, int* resultLen);
```

This looks up the command by name in the ViewDefinition's function map
(AsyncFunction entries that take the view as first argument).

---

## Threading Model

- **View creation**: UI thread (required for XAML element construction)
- **Prop updates**: UI thread (XAML property setters must run on UI thread)
- **Events**: Can fire from any thread — marshaled to JS thread via CallInvoker
- **Commands**: JS thread → C++ → marshaled to UI thread → C# → result back via callback
- **Layout**: Yoga runs on the Fabric thread; `updateLayoutMetrics` on UI thread

Since HostFXR calls are currently synchronous and Fabric prop updates happen
on the UI thread, the prop update path is naturally UI-threaded. For commands
that are async (most are), the C++ side uses `Expo_InvokeAsync` with the
view's function descriptor.

---

## Implementation Phases

### Phase 1: XAML Views with Props

1. Add `IExpoView`, `ViewDefinition`, `PropDescriptor` to C# core
2. Add `View<T>()`, `Prop<T>()` DSL methods to `Module.cs`
3. Add `ViewRegistration` to `ModuleDefinition`
4. Add `ViewRegistry` for view instance management
5. Add `Expo_CreateView`, `Expo_DestroyView`, `Expo_UpdateViewProps`, `Expo_GetViewObject` entry points
6. Add `ExpoViewManager` C++ class — registers with Fabric, creates ContentIsland
7. Extend manifest with `view` field
8. Example: simple colored box view

### Phase 2: Events + Lifecycle

1. Wire view events through existing event callback
2. Add `OnViewDidUpdateProps`, `OnViewDestroys` lifecycle hooks
3. Example: interactive view with event emission

### Phase 3: GroupView (Children)

1. Add `GroupView` DSL component
2. Implement `Expo_MountChildView` / `Expo_UnmountChildView`
3. Forward to Fabric's `MountChildComponentViewHandler`
4. Example: container view with React children

### Phase 4: Composition Views

1. Add `IExpoCompositionView` interface
2. Direct visual path (no ContentIsland)
3. Example: custom-drawn shape view

### Phase 5: Commands

1. Add command dispatch via `Expo_DispatchViewCommand`
2. Wire to `handleCommand` on ComponentView
3. Example: view with imperative `scrollTo()` method

---

## Open Questions

1. **ContentIsland availability**: Need to verify that `ContentIslandComponentView`
   is publicly available in RNW 0.81+ and usable from external packages (not just
   internal RNW components). If not, we may need an alternative XAML hosting
   mechanism.

2. **WinRT interop from .NET 9**: Verify that `Marshal.GetIUnknownForObject()`
   works correctly for WinUI 3 XAML elements when .NET is loaded via HostFXR
   (not a normal UWP/WinUI app). May need CsWinRT projection packages.

3. **Props diff**: RNW's Fabric delivers `AbiViewProps` which wraps
   `folly::dynamic`. Need to verify the exact API for iterating changed props
   vs. extracting the full prop set.

4. **One view per module**: The current design ties one view type to one module
   (like Expo on iOS/Android). If a module needs multiple views, it registers
   multiple modules (same pattern as `expo-maps` having `MapView` and
   `MapMarker` as separate modules).

5. **NativeAOT compatibility**: The view factory uses `Func<TView>` which is
   AOT-safe. The `IInspectable` marshaling via `Marshal.GetIUnknownForObject`
   should also work under NativeAOT, but needs verification.

---

## Reference: Expo iOS View Registration Flow

For comparison, here's how Expo iOS registers a Fabric view:

```
1. Module.Definition() includes View(ExpoFabricView.self) { Prop(...) }
2. Autolinking generates ObjC class: objc_allocateClassPair(ExpoFabricView, "Expo_MapView")
3. ExpoFabricView implements RCTFabricComponentViewProtocol
4. React Native discovers it via the component descriptor registry
5. Props arrive via updateProps(_ props:) → forwarded to module's prop setters
6. Events fire via eventDispatcher
```

Windows equivalent:
```
1. Module.Definition() includes View<MapView>(...) { Prop(...) }
2. C++ reads manifest → registers via WindowsComponentDescriptorRegistry
3. ExpoViewManager sets builder handlers (CreateVisual, UpdateProps, etc.)
4. Fabric discovers it at component resolution time
5. Props arrive via UpdatePropsHandler → JSON → C# prop setters
6. Events fire via existing event callback → ComponentView event emitter
```
