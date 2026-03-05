# Expo Modules Windows Core - High-Level Design

## Vision

Bring the Expo Modules developer experience to Windows, allowing C# developers to write React Native Windows native modules using a clean, declarative DSL — without touching C++ boilerplate.

**Target DX:**

```csharp
public class BatteryModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("Battery"),

        Function("getBatteryLevel", () =>
        {
            var report = Battery.AggregateBattery.GetReport();
            return report.RemainingCapacityInMilliwattHours / (double)report.FullChargeCapacityInMilliwattHours;
        }),

        AsyncFunction("requestPowerMode", async (string mode) =>
        {
            await PowerManager.SetModeAsync(mode);
            return true;
        }),

        Events("onBatteryChanged"),

        OnStartObserving(() =>
        {
            Battery.AggregateBattery.ReportUpdated += (s, e) =>
                SendEvent("onBatteryChanged", new { level = GetLevel() });
        })
    };
}
```

---

## Architecture Overview

### How Expo Modules Work (iOS/Android — our reference)

Expo Modules are **not** individual TurboModules. Instead:

1. A **single TurboModule** (`ExpoModulesCore`) registers with React Native
2. That TurboModule installs a **JSI HostObject** on the JS global (`global.expo.modules`)
3. Each Expo Module (e.g., `Battery`, `FileSystem`) is a **property** on that host object
4. When JS accesses `global.expo.modules.Battery.getBatteryLevel()`, the HostObject's `get()` resolves to the right module and dispatches the call
5. **expo-modules-autolinking** reads `expo-module.json` from each package and generates a platform file (Swift/Kotlin) listing all Module classes to instantiate

We replicate this pattern for Windows, with C# as the module language.

### Windows Architecture

```
┌──────────────────────────────────────────────────────┐
│                     JavaScript                        │
│  global.expo.modules.Battery.getBatteryLevel()        │
└───────────────────────┬──────────────────────────────┘
                        │ JSI HostObject property access
┌───────────────────────▼──────────────────────────────┐
│        C++ ExpoModulesHostObject (single TurboModule) │
│  - Registered as one REACT_MODULE with RNW            │
│  - Implements jsi::HostObject                         │
│  - get("Battery") → dispatches to C# module           │
│  - Loads .NET runtime once at init                    │
│  - Holds module registry from autolinking             │
└───────────────────────┬──────────────────────────────┘
                        │ HostFXR / NativeAOT interop
┌───────────────────────▼──────────────────────────────┐
│              C# Module Registry                       │
│  - List of Module classes (from autolinking codegen)  │
│  - Each module: Definition() → Name, Functions, etc.  │
│  - Marshaling: JSON (MVP) → binary (later)            │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│              C# Modules (user code)                   │
│  class BatteryModule : Module { ... }                 │
│  class ClipboardModule : Module { ... }               │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│           Windows Platform APIs                       │
│  WinRT / Win32 / .NET / WinUI 3                       │
└──────────────────────────────────────────────────────┘
```

### Autolinking Flow

```
expo-module.json (per package)        expo-modules-autolinking (forked)
  { "windows": {                  →     Reads all packages' expo-module.json
      "modules": [                →     Generates: ExpoModulesProvider.g.cs
        "MyApp.BatteryModule"             containing list of Module classes
      ]                           →     Also generates C++ registration code
  }}                                     that hooks into ReactPackageProvider
```

The forked autolinking adds a `"windows"` platform resolver that:
1. Finds packages with `expo-module.json` containing `windows` config
2. Generates a C# file listing all module classes to instantiate
3. Generates C++ glue to register the single ExpoModulesCore TurboModule

---

## Phased Implementation Plan

### Phase 1: MVP — C# DSL + C++ Host Bridge (PoC)

**Goal:** Prove the concept. A single C# module exposing sync/async functions, callable from JS.

**Approach:** HostFXR — the C++ host loads the .NET runtime in-process and calls C# methods through function pointers.

#### 1.1 C# Core Library (`Expo.Modules.Core`)

A .NET class library (`net9.0-windows10.0.19041.0`) containing:

- **`Module`** — abstract base class with `Definition()` method
- **`ModuleDefinition`** — builder/collector class with DSL methods:
  - `Name(string)` — module name visible to JS
  - `Function(string, Delegate)` — synchronous function
  - `AsyncFunction(string, Delegate)` — async function returning Task
  - `Constants(object)` — static constants
  - `Events(params string[])` — event declarations
- **`ModuleRegistry`** — discovers and instantiates all `Module` subclasses
- **`TypeConverter`** — marshals between C# types and a simple interop format (JSON or binary)
- **Interop entry points** — `[UnmanagedCallersOnly]` methods that C++ can call:
  - `GetModuleCount() → int`
  - `GetModuleDefinition(int index) → InteropModuleInfo*`
  - `InvokeFunction(int moduleIndex, int funcIndex, byte* argsJson, int argsLen) → byte*`
  - `InvokeAsyncFunction(...) → void` (with callback pointer)

#### 1.2 C++ Host (`ExpoModulesHostObject`)

A single C++ TurboModule + JSI HostObject:

- **`ExpoModulesHostObject`** — implements `jsi::HostObject`:
  - Registered as a single `REACT_MODULE` (`ExpoModulesCore`)
  - On init: loads .NET runtime via HostFXR, calls C# to get module definitions
  - `get(runtime, name)` → returns a per-module JSI object with functions
  - Each module's functions are `jsi::HostFunction` wrappers that dispatch to C#
- **`ExpoModuleHost`** — .NET runtime loader:
  - Loads .NET via HostFXR (once)
  - Resolves `[UnmanagedCallersOnly]` entry points from C# assembly
  - Caches function pointers for repeated calls
- **`ReactPackageProvider`** — registers the single ExpoModulesCore TurboModule

#### 1.3 Serialization Format (MVP)

For the MVP, use **JSON** for argument/return marshaling:
- JS args → JSON string → C# `System.Text.Json` deserialize
- C# return → JSON string → JSI parse

This is not zero-copy but is simple and correct. Optimize in Phase 3.

#### 1.4 Example Module

A simple module in the example app demonstrating:
- `Function("multiply", (double a, double b) => a * b)`
- `AsyncFunction("fetchData", async () => { ... })`
- `Constants(new { PI = 3.14159 })`

#### 1.5 Build Integration

- C# project builds as part of the VS solution
- MSBuild target copies the C# DLL to the app output directory
- No NativeAOT yet — requires .NET runtime (acceptable for dev/PoC)

**Deliverables:**
- [ ] `Expo.Modules.Core` C# class library
- [ ] `ExpoModuleHost` C++ component
- [ ] JSON-based marshaling
- [ ] Example module (multiply, async fetch)
- [ ] MSBuild integration
- [ ] Working example app

---

### Phase 2: Type System & Events

**Goal:** Rich type support and bidirectional communication (events from native to JS).

#### 2.1 Enhanced Type Conversion

- **Primitives:** `bool`, `int`, `long`, `double`, `string` (direct mapping)
- **Records/DTOs:** C# `record` types auto-converted to/from JS objects
  ```csharp
  public record DeviceInfo(string Name, string OsVersion, double BatteryLevel);
  Function("getDeviceInfo", () => new DeviceInfo("Surface", "11.0", 0.85));
  ```
- **Collections:** `List<T>` ↔ JS arrays, `Dictionary<string, T>` ↔ JS objects
- **Enums:** String-based enum conversion
  ```csharp
  public enum PowerMode { Normal, PowerSaver, HighPerformance }
  Function("setPowerMode", (PowerMode mode) => { ... });
  ```
- **Nullable:** `T?` maps to `T | null` in JS
- **Typed arrays:** `byte[]` ↔ `Uint8Array` (via SharedArrayBuffer for zero-copy)

#### 2.2 Event System

- C# modules call `SendEvent("name", data)`
- The host C++ layer emits via `ReactContext.EmitJSEvent`
- JS side receives via `EventEmitter` pattern (Expo-compatible)

```csharp
Events("onBatteryChanged", "onPowerModeChanged"),

OnStartObserving(() => {
    Battery.ReportUpdated += (s, e) =>
        SendEvent("onBatteryChanged", new { level = 0.8 });
}),

OnStopObserving(() => {
    // cleanup
})
```

#### 2.3 Error Handling

- C# exceptions → JS errors with proper stack traces
- Custom `ModuleException` class for structured error codes
- Async rejection maps to Promise rejection

**Deliverables:**
- [ ] Record/DTO auto-conversion
- [ ] Collection marshaling
- [ ] Enum support
- [ ] Event system (C# → JS)
- [ ] Error propagation
- [ ] TypeScript definition generation from C# types

---

### Phase 3: Performance Optimization

**Goal:** Minimize bridge overhead for production use.

#### 3.1 Binary Marshaling

Replace JSON with a binary protocol:
- Use `System.Buffers` and `Span<byte>` for zero-alloc serialization
- MessagePack or FlatBuffers for structured data
- Direct pointer passing for `ArrayBuffer` ↔ `Span<byte>`

#### 3.2 Source Generator

Roslyn `IIncrementalGenerator` that:
- Scans `Module` subclasses at compile time
- Generates optimized dispatch code (no reflection, no `DynamicInvoke`)
- Creates strongly-typed marshaling code per function signature
- Generates TypeScript `.d.ts` files from C# types

```csharp
// Input: your module
public class MyModule : Module { ... }

// Generated: MyModule.Interop.g.cs
[UnmanagedCallersOnly(EntryPoint = "MyModule_multiply")]
public static double Invoke_multiply(double a, double b) => _instance.multiply(a, b);
```

#### 3.3 NativeAOT Compilation

- Compile C# modules to native DLL (no .NET runtime needed)
- `[UnmanagedCallersOnly]` exports consumed directly by C++ via `GetProcAddress`
- Eliminates HostFXR startup cost
- Reduces deployment size (no .NET runtime distribution)
- **Both HostFXR and NativeAOT remain supported** — modules needing full reflection use HostFXR

#### 3.4 Marshaling Optimization Roadmap

The path from MVP to optimal performance — each step builds on the previous:

| Level | Approach | Who Does the Work | NativeAOT? | Perf |
|-------|----------|-------------------|------------|------|
| **L0 (MVP)** | JSON via `System.Text.Json` | Runtime (de)serialization | ✅ with source gen | Baseline |
| **L1** | STJ Source Generators | Compile-time serializer codegen | ✅ | ~2-3x faster |
| **L2** | Roslyn Source Generator — typed dispatch | Generate per-function `[UnmanagedCallersOnly]` exports with known signatures — no `Delegate.DynamicInvoke`, no JSON for primitives | ✅ | ~10x faster |
| **L3** | Binary protocol (MessagePack/FlatBuffers) | For complex objects only — primitives already pass on the stack at L2 | ✅ | ~15x faster |
| **L4 (aspirational)** | Direct JSI integration via C++/CLI or COM | C# code directly manipulates `jsi::Runtime` via a safe wrapper — no marshaling at all | ❓ research needed | Near-native |

**Key design principle:** The C++ host always converts `jsi::Value` → native types on the C++ side, then calls into C# with typed arguments. We never expose raw `jsi::Value` pointers to C# — this keeps the ABI stable across JSI/Hermes versions and avoids coupling to C++ class layouts.

**L2 in detail (the sweet spot):**
```csharp
// Module author writes:
Function("add", (int a, int b) => a + b);

// Source generator emits:
[UnmanagedCallersOnly(EntryPoint = "MathModule_add")]
public static int MathModule_add(int a, int b) => _instance._add(a, b);
```
C++ calls the generated export directly — no JSON, no reflection, no delegate indirection. Primitives pass on the stack. Only complex objects (records, arrays, dictionaries) go through a serialization layer.

**Deliverables:**
- [ ] Binary serialization protocol
- [ ] Roslyn source generator
- [ ] NativeAOT build pipeline
- [ ] TypeScript codegen from source generator
- [ ] Performance benchmarks (vs JSON, vs pure C++)

---

### Phase 4: View Components

**Goal:** Support native Windows UI components defined in C#/XAML.

#### 4.1 View DSL

```csharp
public class MapViewModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("ExpoMapView"),

        View(() => new MapControl())
        {
            Prop("center", (MapControl view, GeoPoint center) => {
                view.Center = new Geopoint(new BasicGeoposition {
                    Latitude = center.Lat, Longitude = center.Lng
                });
            }),

            Prop("zoomLevel", (MapControl view, double zoom) => {
                view.ZoomLevel = zoom;
            }),

            Events("onRegionChanged"),
        }
    };
}
```

#### 4.2 View Manager Bridge

- C++ `IViewManager` implementation that creates WinUI/XAML elements
- Props dispatched to C# setters
- Layout handled by Yoga (standard RNW behavior)
- Events bubble through the C++ layer

**Deliverables:**
- [ ] View definition DSL
- [ ] ViewManager C++ bridge
- [ ] Prop setter dispatch
- [ ] View event system
- [ ] Example: custom XAML control in React Native

---

### Phase 5: Developer Experience & Tooling

**Goal:** Make the library easy to adopt.

#### 5.1 Project Template / CLI

- `npx create-expo-windows-module <name>` scaffolds a new module
- Generates: C# project, C++ host shim, TypeScript spec, example app wiring
- Handles MSBuild/NuGet configuration

#### 5.2 Hot Reload

- Leverage .NET Hot Reload for C# module code changes
- No full rebuild needed during development
- Metro fast refresh + C# hot reload = full-stack hot reload

#### 5.3 NuGet Package

- `Expo.Modules.Windows.Core` NuGet package
- Contains: base classes, source generator, C++ host headers
- Consumers just add NuGet reference + write modules

#### 5.4 Documentation

- Getting started guide
- API reference (generated from XML docs)
- Migration guide from `Microsoft.ReactNative.Managed`
- Example modules for common Windows APIs

**Deliverables:**
- [ ] CLI scaffolding tool
- [ ] NuGet package
- [ ] Hot reload support
- [ ] Documentation site
- [ ] Example modules (file system, notifications, clipboard, etc.)

---

## Technical Decisions

### Why HostFXR for MVP (not NativeAOT)?

| Factor | HostFXR | NativeAOT |
|--------|---------|-----------|
| **Dev iteration speed** | Fast (no AOT compile) | Slow (full recompile) |
| **Debugging** | Full .NET debugger | Limited |
| **Reflection** | Full runtime reflection | Limited (see below) |
| **Hot Reload** | Supported | Not supported |
| **Runtime dependency** | Requires .NET | Self-contained |
| **Binary size** | Small DLL + runtime | ~10MB+ per module |

HostFXR is better for development. NativeAOT is better for production/distribution. Support both.

**NativeAOT reflection nuance:** NativeAOT doesn't eliminate reflection — it limits it. `typeof(T)`, attribute lookup, and reflection on statically-reachable types all work. What breaks: `Assembly.GetTypes()` scanning, `MethodInfo.Invoke()` on trimmed methods, `Marshal.GetFunctionPointerForDelegate()` for dynamic delegates, and `Expression.Compile()`. Our infrastructure uses source generators to avoid these. Module authors can use most C# features freely (LINQ, async/await, generics, records). Advanced modules needing full reflection fall back to HostFXR.

### Why JSON for MVP marshaling? (Not raw pointers)

- `System.Text.Json` is fast, well-tested, and handles complex types
- JSI has efficient JSON parsing built in
- Correctness first, then optimize
- Easy to debug (human-readable)
- AOT-compatible with source generators (unlike reflection-based pointer mapping)

**Why NOT raw JSI pointer passing (Gemini's "zero-JSON" proposal):**
- `jsi::Value` is a C++ class with compiler-specific layout, not a stable ABI struct — mapping it to a C# `StructLayout` is fragile and breaks across RNW versions
- "Back-link" P/Invoke calls for every string/object read are each a managed→native transition with their own overhead
- The approach requires `Marshal.GetFunctionPointerForDelegate` and `MethodInfo.Invoke` — both incompatible with NativeAOT
- Expo on iOS/Android also uses conversion layers (not raw pointer passing)
- The real optimization path is source generators + typed dispatch, not raw memory access

### Why not use `node-api-dotnet` directly?

- It targets Node-API, not JSI — different ABI
- RNW's Hermes doesn't expose a stable Node-API surface
- We'd need an adapter layer anyway
- Better to build a purpose-built bridge for JSI

### Module Discovery — Autolinking

Modules are NOT discovered at runtime. Instead, **expo-modules-autolinking** (forked with Windows support) generates a static list at build time:

1. Each package declares its modules in `expo-module.json` under `"windows"` key
2. At prebuild/install time, autolinking scans all packages
3. Generates `ExpoModulesProvider.g.cs` with a static list of module class names
4. The C# registry instantiates exactly those classes — no reflection scanning needed
5. This is AOT-compatible from day one

This matches how iOS/Android work: autolinking generates `ExpoModulesProvider.swift` / `ExpoModulesProvider.kt`.

---

## Project Structure (Target)

```
expo-modules-windows-core/          # This repo — the core library
├── src/                            # TypeScript (JS-side API, EventEmitter, etc.)
├── windows/
│   ├── ExpoModulesWindowsCore/     # C++ host (single TurboModule)
│   │   ├── ExpoModulesHostObject.h/cpp  # JSI HostObject implementation
│   │   ├── ExpoModuleHost.h/cpp    # HostFXR .NET runtime loader
│   │   ├── Marshaling.h/cpp        # JSI ↔ JSON conversion
│   │   └── ... (existing RNW files)
│   └── ExpoModulesWindowsCore.sln
├── dotnet/
│   ├── Expo.Modules.Core/          # C# core library (NuGet package)
│   │   ├── Module.cs               # Abstract base class
│   │   ├── ModuleDefinition.cs     # DSL builder
│   │   ├── ModuleRegistry.cs       # Instantiates modules from autolinking list
│   │   ├── TypeConverter.cs        # JSON marshaling
│   │   └── Interop/                # [UnmanagedCallersOnly] entry points
│   ├── Expo.Modules.Generator/     # Roslyn source generator (Phase 3)
│   └── Expo.Modules.Core.csproj
├── example/
│   ├── modules/                    # Example C# modules
│   │   ├── ExampleModule.cs
│   │   └── expo-module.json        # Declares modules for autolinking
│   └── windows/
│       └── ExpoModulesProvider.g.cs  # Generated by autolinking
└── docs/

expo-modules-autolinking/           # Separate forked repo
├── src/
│   ├── platforms/
│   │   ├── ios.ts                  # Existing
│   │   ├── android.ts              # Existing
│   │   └── windows.ts              # NEW — Windows platform resolver
│   └── ...
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| HostFXR loading fails in RNW process | Blocks MVP | **PoC spike first** — test early; fallback to separate process or NativeAOT-only |
| JSON marshaling too slow for real apps | Perf issues | Phase 3 binary protocol; benchmark early |
| RNW internals change (breaking) | Maintenance burden | Pin RNW version; use public APIs only |
| NativeAOT limitations (limited reflection) | Blocks some modules in Phase 3 | Source generators for core infra; HostFXR fallback for advanced modules needing full reflection |
| expo-modules-autolinking fork diverges from upstream | Maintenance | Keep fork minimal; propose upstream PR for Windows platform |
| Thread safety (JS thread vs .NET threads) | Race conditions | Clear threading model; dispatch to correct thread |
| Mixed C++/C# solution build complexity | DX friction | Thorough MSBuild integration; test on clean machines |

---

## Success Criteria

### MVP (Phase 1)
- A C# module with `Function("multiply", ...)` is callable from JS
- An `AsyncFunction` returns a Promise to JS
- Build integration "just works" in VS solution
- Example app demonstrates the concept

### Production Ready (Phase 3+)
- Performance within 2x of pure C++ TurboModule
- NativeAOT support for zero-dependency distribution
- TypeScript definitions auto-generated
- At least 5 example modules covering common Windows APIs
