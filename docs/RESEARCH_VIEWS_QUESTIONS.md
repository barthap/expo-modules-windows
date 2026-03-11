# Research: View Component Open Questions

Research conducted 2026-03-11 against RNW 0.81+ (main branch).

---

## Q1: ContentIsland / ContentIslandComponentView Availability

### Is `ContentIslandComponentView` publicly available in RNW 0.81+?

**Yes.** `ContentIslandComponentView` is a public WinRT runtimeclass in the `Microsoft.ReactNative.Composition` namespace. It is defined in the public IDL (`CompositionComponentView.idl`) and ships with the `react-native-windows` NuGet package.

**IDL definition** (from `CompositionComponentView.idl`):
```idl
[experimental]
[webhosthidden]
runtimeclass ContentIslandComponentView : ViewComponentView {
  void Connect(Microsoft.UI.Content.ContentIsland contentIsland);
  Microsoft.UI.Content.ChildSiteLink ChildSiteLink { get; };
};
```

### Can external native module packages use it?

**Yes.** The `IReactCompositionViewComponentBuilder` interface exposes:
```idl
void SetContentIslandComponentViewInitializer(ComponentIslandComponentViewInitializer initializer);
```

This means an external library can register a Fabric component that uses `ContentIslandComponentView` as its backing view type (instead of the default `ViewComponentView`). When you call `SetContentIslandComponentViewInitializer`, the builder creates a `ContentIslandComponentView` instance and passes it to your initializer callback.

### How does it work?

The `ContentIslandComponentView` hosts external content via the Windows App SDK `Microsoft.UI.Content.ContentIsland` API:

1. The component creates a `ChildSiteLink` connecting to the parent `ContentIsland` (the RNW root's `ReactNativeIsland`).
2. You call `Connect(contentIsland)` to attach your XAML/WinUI content island.
3. The `ChildSiteLink` bridges the external content island into the Fabric composition visual tree.
4. Layout metrics (position, scale) are synchronized automatically.

**Key detail:** This uses modern WinUI 3 APIs (`Microsoft.UI.Content.ContentIsland` and `ChildSiteLink`), NOT the legacy XAML Islands / `DesktopChildSiteBridge` pattern.

### Is there a simpler alternative?

For **pure Composition visuals** (no XAML controls), the standard `ViewComponentView` with `SetCreateVisualHandler` is simpler — you just return a `Microsoft.UI.Composition.Visual`. This is what the CircleMask example does.

`ContentIslandComponentView` is needed only when you want to host **full XAML control trees** (UserControl, TextBox, etc.) inside a Fabric component.

### Current status

The APIs are marked `[experimental]`. A "Xaml Island Prototyping" issue (#15035) was opened and closed in August 2025, suggesting the infrastructure is in place but may still evolve. The RNW team has stated they "fully expect to support developers implementing New Architecture ComponentViews by loading XAML controls" but note it's "not quite production ready yet."

**Sources:**
- [RNW API Reference](https://microsoft.github.io/react-native-windows/docs/native-api/Native-API-Reference)
- [IReactCompositionViewComponentBuilder docs](https://microsoft.github.io/react-native-windows/docs/native-api/IReactCompositionViewComponentBuilder)
- [ContentIslandComponentView.h (RNW source)](https://github.com/microsoft/react-native-windows/blob/main/vnext/Microsoft.ReactNative/Fabric/Composition/ContentIslandComponentView.h)
- [ContentIslandComponentView.cpp (RNW source)](https://github.com/microsoft/react-native-windows/blob/main/vnext/Microsoft.ReactNative/Fabric/Composition/ContentIslandComponentView.cpp)
- [XAML Island Prototyping issue #15035](https://github.com/microsoft/react-native-windows/issues/15035)

---

## Q2: WinRT Interop from .NET 9 Loaded via HostFXR

### Can we use WinRT types from HostFXR-loaded .NET?

**Yes, with caveats.** When .NET 9 is loaded in-process via HostFXR, the .NET runtime is fully functional. CsWinRT projections are NuGet-based and work in any .NET class library — they don't require a special app model. The key requirements:

1. **Target framework** must be Windows-specific: `net9.0-windows10.0.19041.0` (or similar)
2. **NuGet packages needed:**
   - `Microsoft.Windows.CsWinRT` — the C#/WinRT projection tooling
   - `Microsoft.WindowsAppSDK` — for WinUI 3 / Windows App SDK types (`Microsoft.UI.Composition`, `Microsoft.UI.Xaml`, `Microsoft.UI.Content`)
   - `Microsoft.Windows.SDK.NET.Ref` — for Windows SDK types (comes implicitly with the TFM)

### Does `Marshal.GetIUnknownForObject()` work?

**Avoid it.** Starting with .NET 5, direct WinRT support was removed from the CLR. The RCW/CCW functions in `System.Runtime.InteropServices.Marshal` are **incompatible** with CsWinRT's `ComWrappers`-based approach.

**Use CsWinRT's interop APIs instead:**
- `MarshalInterface<T>.FromManaged(obj)` → returns `IntPtr` (IUnknown*)
- `MarshalInterface<T>.FromAbi(ptr)` → returns managed object from pointer
- `MarshalInspectable<T>.FromManaged(obj)` → for IInspectable-based types
- `MarshalInspectable<T>.FromAbi(ptr)` → reverse

These work correctly with CsWinRT's COM wrapper infrastructure and are the recommended way to pass WinRT object pointers across the native/managed boundary.

### HostFXR-specific concerns

When .NET is loaded via HostFXR into a C++ process that already has a WinUI 3 `DispatcherQueue` and `Compositor`:
- The C# code can **receive** native COM/WinRT pointers from C++ and wrap them using `FromAbi`
- The C# code can **return** native COM/WinRT pointers to C++ using `FromManaged`
- WinRT activation (creating new WinRT objects) should work because the Windows App SDK DLLs are already loaded in-process
- **Potential issue:** XAML framework initialization (`Application.Start()`) typically happens from the app's `main()`. If the C# module tries to create XAML controls, it needs the XAML framework already initialized by the host process. For Composition-only visuals, this is not an issue.

### Recommended approach for our design

For the MVP, passing `IUnknown*`/`IInspectable*` pointers as `IntPtr` through the existing interop boundary (JSON or direct function pointers) is viable:
1. C++ creates `Compositor` and passes its `IUnknown*` to C# via interop
2. C# wraps it: `var compositor = MarshalInterface<Compositor>.FromAbi(ptr);`
3. C# creates visuals, returns their `IUnknown*` back to C++
4. C++ connects the visual to the Fabric composition tree

**Sources:**
- [CsWinRT interop docs](https://github.com/microsoft/CsWinRT/blob/master/docs/interop.md)
- [CsWinRT NuGet/usage](https://github.com/microsoft/CsWinRT/blob/master/docs/usage.md)
- [Create C# WinRT component with WinUI 3](https://learn.microsoft.com/en-us/windows/apps/develop/platform/csharp-winrt/create-winrt-component-winui-cswinrt)
- [Use Windows App SDK in existing project](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/use-windows-app-sdk-in-existing-project)

---

## Q3: RNW Fabric Props API

### How do props arrive at a custom ComponentView?

Props flow through a layered system:

1. **JS → C++ Fabric core:** React's reconciler sends prop changes to the Fabric C++ core via JSI.
2. **Fabric core → `IComponentProps`:** RNW's codegen generates a props struct implementing `IComponentProps`. The `ViewPropsFactory` delegate creates/clones it.
3. **`IComponentProps` → your handler:** The `UpdatePropsDelegate` is called with old and new props.

### Exact delegate signature

From `IReactViewComponentBuilder.idl`:
```idl
delegate void UpdatePropsDelegate(
    ComponentView source,
    IComponentProps newProps,
    IComponentProps oldProps);
```

The `source` is the `ComponentView` instance. `newProps` and `oldProps` are `IComponentProps` — your codegen-generated props struct.

### Props factory

```idl
delegate IComponentProps ViewPropsFactory(
    ViewProps props,
    IComponentProps cloneFrom);
```

The factory receives a `ViewProps` object (containing the base view props like layout, opacity, etc.) and a `cloneFrom` reference for diffing. You return your custom `IComponentProps` implementation.

### How codegen handles props

The Windows codegen (`componentsWindows` generator) produces:
- A `BaseXxx<TDerived>` CRTP template class
- A `RegisterXxxNativeComponent<TComponent>()` function
- Typed prop accessors on the generated props struct

The `BaseCircleMask` template (from the CircleMask example) handles props registration automatically. The derived class can override `UpdateProps` to react to prop changes, or access typed props through the generated accessors.

### Iterating changed props vs. full set

The `UpdatePropsDelegate` receives both `newProps` and `oldProps`. You compare fields manually — there is no built-in "changed props mask." This matches the iOS/Android Fabric pattern where `updateProps` receives the full new props and the previous props.

**Sources:**
- [IReactViewComponentBuilder.idl (RNW source)](https://raw.githubusercontent.com/microsoft/react-native-windows/main/vnext/Microsoft.ReactNative/IReactViewComponentBuilder.idl)
- [Native Platform Components docs](https://microsoft.github.io/react-native-windows/docs/native-platform-components)
- [CircleMask example (RNW samples)](https://github.com/microsoft/react-native-windows-samples/blob/main/docs/native-platform-components.md)

---

## Q4: Component Registration API

### Exact C++ API for registering a custom Fabric view component

Registration uses `IReactPackageBuilderFabric.AddViewComponent`:

```cpp
void AddViewComponent(string componentName, ReactViewComponentProvider componentProvider)
```

Where `ReactViewComponentProvider` is a delegate receiving `IReactViewComponentBuilder`.

### Full registration pattern (from CircleMask example)

```cpp
void RegisterCircleMaskNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept
{
    // The codegen-generated function handles the boilerplate:
    testlibCodegen::RegisterCircleMaskNativeComponent<CircleMaskComponentView>(
        packageBuilder,
        [](const winrt::Microsoft::ReactNative::Composition::
               IReactCompositionViewComponentBuilder &builder) {
            builder.SetViewFeatures(
                winrt::Microsoft::ReactNative::Composition::ComponentViewFeatures::Default &
                ~winrt::Microsoft::ReactNative::Composition::ComponentViewFeatures::NativeBorder);
        });
}
```

Called from `ReactPackageProvider::CreatePackage`:
```cpp
void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
    RegisterCircleMaskNativeComponent(packageBuilder);
}
```

### IReactCompositionViewComponentBuilder methods

From the IDL:
```idl
interface IReactCompositionViewComponentBuilder {
    void SetViewComponentViewInitializer(ViewComponentViewInitializer initializer);
    void SetContentIslandComponentViewInitializer(ComponentIslandComponentViewInitializer initializer);
    void SetPortalComponentViewInitializer(PortalComponentViewInitializer initializer);
    void SetCreateVisualHandler(CreateVisualDelegate impl);
    void SetViewFeatures(ComponentViewFeatures viewFeatures);
    void SetUpdateLayoutMetricsHandler(UpdateLayoutMetricsDelegate impl);
    void SetVisualToMountChildrenIntoHandler(VisualToMountChildrenIntoDelegate impl);
};
```

Key delegate types:
```idl
delegate Microsoft.UI.Composition.Visual CreateVisualDelegate(ComponentView view);
delegate void ViewComponentViewInitializer(ViewComponentView view);
delegate void ComponentIslandComponentViewInitializer(ContentIslandComponentView view);
delegate void UpdateLayoutMetricsDelegate(ComponentView source, LayoutMetrics newMetrics, LayoutMetrics oldMetrics);
delegate Microsoft.UI.Composition.Visual VisualToMountChildrenIntoDelegate(ComponentView view);
```

Plus from `IReactViewComponentBuilder` (the base builder):
```idl
void SetCreateProps(ViewPropsFactory impl);
void SetUpdatePropsHandler(UpdatePropsDelegate impl);
void SetUpdateStateHandler(UpdateStateDelegate impl);
void SetUpdateEventEmitterHandler(UpdateEventEmitterDelegate impl);
void SetMountChildComponentViewHandler(MountChildComponentViewDelegate impl);
void SetUnmountChildComponentViewHandler(UnmountChildComponentViewDelegate impl);
void SetCustomCommandHandler(HandleCommandDelegate impl);
void SetFinalizeUpdateHandler(UpdateFinalizerDelegate impl);
void SetComponentViewInitializer(ComponentViewInitializer initializer);
void SetMeasureContentHandler(MeasureContentHandler impl);
void SetLayoutHandler(LayoutHandler impl);
void SetCreateAutomationPeerHandler(CreateAutomationPeerDelegate impl);
void SetCreateShadowNode(ViewShadowNodeFactory impl);
void SetShadowNodeCloner(ViewShadowNodeCloner impl);
void SetInitialStateDataFactory(InitialStateDataFactory impl);
```

### ComponentViewFeatures enum
```idl
[flags] enum ComponentViewFeatures {
    None         = 0x00000000,
    NativeBorder = 0x00000001,
    ShadowProps  = 0x00000002,
    Background   = 0x00000004,
    FocusVisual  = 0x00000008,
    Default      = 0x0000000F,
};
```

### Can a library register view components dynamically at runtime?

**Yes.** Libraries register components through `IReactPackageProvider.CreatePackage()`, which is called during React instance initialization. This is the standard extensibility point — any library providing an `IReactPackageProvider` can register view components. The `WindowsComponentDescriptorRegistry` supports runtime lookup of externally registered component descriptors.

The registration happens at React instance creation time, not at build time. No code generation or manifest is needed on the app side beyond referencing the library.

### Component implementation pattern

A component view struct must:
1. Inherit from the codegen-generated `BaseXxx<TDerived>` template
2. Implement `winrt::implements<T, winrt::IInspectable>`
3. Override `CreateVisual(ComponentView view)` → returns `Microsoft.UI.Composition.Visual`
4. Optionally override `Initialize(ComponentView view)` for lifecycle setup

```cpp
struct CircleMaskComponentView
    : winrt::implements<CircleMaskComponentView, winrt::IInspectable>,
      testlibCodegen::BaseCircleMask<CircleMaskComponentView> {

    winrt::Microsoft::UI::Composition::Visual CreateVisual(
        const winrt::Microsoft::ReactNative::ComponentView &view) noexcept override;

    void Initialize(
        const winrt::Microsoft::ReactNative::ComponentView &view) noexcept override;
};
```

**Sources:**
- [IReactCompositionViewComponentBuilder.idl (RNW source)](https://raw.githubusercontent.com/microsoft/react-native-windows/main/vnext/Microsoft.ReactNative/IReactCompositionViewComponentBuilder.idl)
- [IReactViewComponentBuilder.idl (RNW source)](https://raw.githubusercontent.com/microsoft/react-native-windows/main/vnext/Microsoft.ReactNative/IReactViewComponentBuilder.idl)
- [IReactPackageBuilderFabric docs](https://microsoft.github.io/react-native-windows/docs/native-api/IReactPackageBuilderFabric)
- [IReactCompositionViewComponentBuilder docs](https://microsoft.github.io/react-native-windows/docs/native-api/IReactCompositionViewComponentBuilder)
- [Native Platform Components guide](https://microsoft.github.io/react-native-windows/docs/native-platform-components)
- [ComponentViewRegistry.cpp (RNW source)](https://github.com/microsoft/react-native-windows/blob/main/vnext/Microsoft.ReactNative/Fabric/Composition/ComponentViewRegistry.cpp)

---

## Q5: NativeAOT + WinRT Marshaling

### Does `Marshal.GetIUnknownForObject()` work under NativeAOT for WinRT types?

**No.** `Marshal.GetIUnknownForObject()` is incompatible with both:
- CsWinRT's `ComWrappers`-based approach (since .NET 5)
- NativeAOT's disabled runtime marshaling requirement

### Known limitations with CsWinRT + NativeAOT

1. **`IObjectReference.As<T>()` broke on NativeAOT** due to `MakeGenericMethod()` — fixed in CsWinRT 2.1.1+ (issue [#1320](https://github.com/microsoft/CsWinRT/issues/1320), closed/completed).

2. **COM class authoring with WinRT interfaces** — `[GeneratedComClass]` on a type deriving from C#/WinRT generated interfaces can cause `System.ExecutionEngineException` under AOT (issue [#1722](https://github.com/microsoft/CsWinRT/issues/1722)). This is a known pain point.

3. **Source generator improvements** — CsWinRT now includes a source generator (`WinRT.SourceGenerator`) that pre-generates marshaling code at compile time, reducing runtime reflection. This is key for AOT compatibility.

4. **Known source generator issues** tracked in [#1809](https://github.com/microsoft/CsWinRT/issues/1809).

### Recommended approach for our project

- **MVP (HostFXR):** Use `MarshalInterface<T>.FromManaged/FromAbi` — fully supported, no AOT concerns.
- **Future (NativeAOT):** CsWinRT AOT support is actively improving. By the time we reach NativeAOT phase, many current issues may be resolved. Key mitigation: use `[GeneratedComInterface]` / `[GeneratedComClass]` from .NET 8+ instead of legacy Marshal APIs. Avoid mixing COM and WinRT interface inheritance on the same type.
- **Worst case fallback:** For NativeAOT, we could pass raw `IUnknown*` pointers and use manual COM QueryInterface from the C++ side, avoiding CsWinRT marshaling entirely for the visual bridge.

**Sources:**
- [CsWinRT issue #1722 — AOT + COM/WinRT mix](https://github.com/microsoft/CsWinRT/issues/1722)
- [CsWinRT issue #1320 — IObjectReference.As<T> NativeAOT](https://github.com/microsoft/CsWinRT/issues/1320)
- [CsWinRT issue #1809 — Known source generator issues](https://github.com/microsoft/CsWinRT/issues/1809)
- [CsWinRT interop docs](https://github.com/microsoft/CsWinRT/blob/master/docs/interop.md)
- [.NET Community Toolkit 8.3 NativeAOT blog](https://devblogs.microsoft.com/dotnet/announcing-the-dotnet-community-toolkit-830/)

---

## Summary: Implications for expo-modules-windows-core View Design

### Two viable approaches

| Approach | Backing Type | Use Case | Complexity |
|----------|-------------|----------|------------|
| **Composition-only** | `ViewComponentView` + `CreateVisualDelegate` | Custom drawing, shapes, animations | Lower |
| **XAML hosting** | `ContentIslandComponentView` + `ContentIsland` | Full XAML controls (TextBox, ListView, etc.) | Higher |

### Recommended phased approach

1. **Phase 1 (MVP):** Support Composition-only views. C# module creates `Microsoft.UI.Composition.Visual` and returns its `IUnknown*` to C++. C++ registers the Fabric component via `SetCreateVisualHandler` and connects the visual.

2. **Phase 2:** Add XAML hosting via `ContentIslandComponentView`. C# module creates a XAML `ContentIsland`, C++ connects it via `Connect()`.

### Key architectural decisions

- **C++ is the registration layer.** Fabric component registration (`AddViewComponent`, `IReactCompositionViewComponentBuilder`) is a C++ WinRT API. Our C++ host must register components and delegate to C# for visual creation and prop handling.
- **Props flow through C++.** The `UpdatePropsDelegate` fires in C++ with `IComponentProps`. We need to serialize/forward these to C# (similar to how we handle function calls).
- **Visual creation can be delegated.** `CreateVisualDelegate` returns a `Microsoft.UI.Composition.Visual`. C++ can call into C# to create the visual and return the COM pointer.
- **Codegen is C++-side.** RNW's `componentsWindows` codegen generates C++ headers. We'll need our own codegen or a generic registration pattern on the C++ side that wraps C# view definitions.
