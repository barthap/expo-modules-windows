# Code Flow: C# Module Definition → JavaScript

How a C# lambda like `(a, b) => a * b` in `ExampleModule.cs` ends up callable from JavaScript as `global.expo.modules.ExampleModule.multiply(3, 4)`.

---

## Overview

```
C# Module DSL  →  C# ModuleRegistry  →  [UnmanagedCallersOnly] exports
                                              ↕ (HostFXR function pointers)
JS global.expo.modules  ←  JSI HostObject  ←  C++ ExpoModuleHost
```

Three boundaries are crossed:
1. **C# DSL → C# Registry**: Reflection-based. `Definition()` is called once; delegates and parameter types are captured.
2. **C# ↔ C++**: Via `[UnmanagedCallersOnly]` function pointers resolved through HostFXR. Data crosses as UTF-8 JSON byte buffers.
3. **C++ → JS**: Via JSI `HostObject`. Each module is a HostObject whose properties are JSI HostFunctions.

---

## Phase 1: C# — Module Definition

### ExampleModule.cs (user code)

```csharp
public class ExampleModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("ExampleModule"),
        Function<double, double, double>("multiply", (a, b) => a * b),
        AsyncFunction<double, double>("delayedSquare", async (x) => {
            await Task.Delay(500);
            return x * x;
        }),
        Constants(new { platform = "windows" }),
        Events("onStatusChange"),
    };
}
```

### What happens at `new ModuleDefinition { ... }`

`ModuleDefinition` implements `IEnumerable` and has `void Add(IDefinitionComponent)`. This enables collection initializer syntax. Each DSL call returns an `IDefinitionComponent`:

| DSL Call | Component | Effect on ModuleDefinition |
|----------|-----------|--------------------------|
| `Name("ExampleModule")` | `NameComponent` | Sets `ModuleName = "ExampleModule"` |
| `Function<T1,T2,TResult>("multiply", fn)` | `FunctionComponent` | Adds to `SyncFunctions["multiply"]` |
| `AsyncFunction<T1,TResult>("delayedSquare", fn)` | `AsyncFunctionComponent` | Adds to `AsyncFunctions["delayedSquare"]` |
| `Constants(new { ... })` | `ConstantsComponent` | Reflects properties into `ConstantsMap` |
| `Events("onStatusChange")` | `EventsComponent` | Adds to `EventNames` |

### FunctionDescriptor — capturing the delegate

When `Function<double, double, double>("multiply", (a, b) => a * b)` is called:

```csharp
public class FunctionDescriptor
{
    public string Name;           // "multiply"
    public Delegate Delegate;     // the (a, b) => a * b lambda
    public Type[] ParameterTypes; // [typeof(double), typeof(double)]
    public Type ReturnType;       // typeof(double)
    public bool IsAsync;          // false
}
```

`ParameterTypes` are extracted via `Delegate.Method.GetParameters()` at construction time — this metadata is needed later for JSON deserialization.

### ModuleRegistry — instantiation

```
ModuleRegistry(types: [typeof(ExampleModule)])
  → Activator.CreateInstance(typeof(ExampleModule))  // creates the module
  → module.Definition()                               // calls Definition() once
  → stores ModuleDefinition in _definitions[0]
  → stores Module instance in _modules[0]
  → maps "ExampleModule" → index 0
```

---

## Phase 2: C++ ↔ C# Bridge (HostFXR)

### Bootstrap sequence (ExpoModuleHost::Initialize)

```
1. LoadHostFxr()
   → get_hostfxr_path() finds hostfxr.dll
   → LoadLibraryW("hostfxr.dll")
   → GetProcAddress: hostfxr_initialize_for_runtime_config,
                     hostfxr_get_runtime_delegate,
                     hostfxr_close

2. InitializeRuntime(runtimeConfigPath)
   → hostfxr_initialize_for_runtime_config("Expo.Modules.Core.runtimeconfig.json")
   → hostfxr_get_runtime_delegate(hdt_load_assembly_and_get_function_pointer)
   → saves load_assembly_and_get_function_pointer_fn

3. ResolveExports("Expo.Modules.Core.dll")
   → For each C# export, calls:
     load_assembly_and_get_function_pointer(
       "Expo.Modules.Core.dll",
       "Expo.Modules.Core.Interop.NativeEntryPoints, Expo.Modules.Core",
       "Expo_Initialize",
       UNMANAGEDCALLERSONLY_METHOD,  // special constant
       nullptr,
       &m_expoInitialize)           // receives function pointer

   Resolves 8 function pointers:
     Expo_DiscoverModules, Expo_Initialize, Expo_GetModuleCount,
     Expo_GetModuleDefinitions, Expo_InvokeSync, Expo_InvokeAsync,
     Expo_EmitEvent_SetCallback, Expo_FreeBuffer

4. Expo_DiscoverModules("managed/ExampleModules.dll")
   → C# loads assembly, finds ExpoModulesProvider class
   → Calls GetModuleClasses() → [typeof(ExampleModule)]
   → Returns assembly-qualified type names as JSON:
     ["ExampleModules.ExampleModule, ExampleModules, Version=1.0.0.0, ..."]

5. Expo_Initialize(typeNamesJson)
   → C# resolves types via Type.GetType()
   → Creates ModuleRegistry, calls Initialize()
   → All modules instantiated, Definition() called

6. Expo_GetModuleDefinitions()
   → Returns JSON manifest:
     [{
       "name": "ExampleModule",
       "syncFunctions": ["multiply", "greet"],
       "asyncFunctions": ["delayedSquare"],
       "constants": { "platform": "windows", ... },
       "events": ["onStatusChange"]
     }]
   → C++ parses into vector<ModuleInfo>
```

### Memory contract

All data crosses the C++ ↔ C# boundary as byte buffers:
- **C# allocates** via `Marshal.AllocHGlobal` and writes JSON bytes
- **C++ reads** the buffer, copies what it needs
- **C++ frees** by calling `Expo_FreeBuffer` (which calls `Marshal.FreeHGlobal`)

---

## Phase 3: JSI HostObject Installation

After `ExpoModuleHost::Initialize()` completes, the C++ side has a `vector<ModuleInfo>` with metadata for all modules. Now it installs a JSI HostObject.

### callInvoker->invokeAsync (from REACT_INIT)

```cpp
callInvoker->invokeAsync([hostObj](facebook::jsi::Runtime& rt) {
    auto global = rt.global();
    Object expo = ...;  // get or create global.expo
    expo.setProperty(rt, "modules",
        Object::createFromHostObject(rt, hostObj));  // ExpoModulesHostObject
    global.setProperty(rt, "expo", expo);
});
```

This runs asynchronously on the JS thread after the JSI runtime is ready.

### ExpoModulesHostObject — the `global.expo.modules` object

A JSI `HostObject`. When JS accesses a property:

```
JS: global.expo.modules.ExampleModule
  → ExpoModulesHostObject::get(rt, "ExampleModule")
    → m_host.FindModule("ExampleModule") → ModuleInfo at index 0
    → creates ExpoModuleObject(host, moduleInfo, callInvoker)
    → caches it for future access
    → returns Object::createFromHostObject(rt, moduleObj)
```

### ExpoModuleObject — the per-module object

Also a JSI `HostObject`. Each property access is intercepted:

```
JS: ExampleModule.multiply
  → ExpoModuleObject::get(rt, "multiply")
    → "multiply" is in syncFunctions set
    → calls createSyncFunction(rt, "multiply")
    → returns a JSI Function (cached for future calls)

JS: ExampleModule.constants
  → ExpoModuleObject::get(rt, "constants")
    → parses constantsJson via Value::createFromJsonUtf8
    → returns the parsed object
```

---

## Phase 4: Function Invocation

### Sync call: `ExampleModule.multiply(3, 4)`

```
JS calls the JSI HostFunction
  │
  ├─ C++ lambda runs (captured: host, moduleIdx=0, funcName="multiply")
  │  │
  │  ├─ jsiArgsToJson(rt, [3, 4]) → "[3,4]"
  │  │
  │  ├─ host->InvokeSync(0, "multiply", "[3,4]", &resultJson, &resultLen)
  │  │   │
  │  │   └─ Calls C# Expo_InvokeSync via function pointer
  │  │       │
  │  │       ├─ Looks up _registry.GetDefinition(0).SyncFunctions["multiply"]
  │  │       │   → FunctionDescriptor { Delegate = (a,b) => a*b, Params = [double, double] }
  │  │       │
  │  │       ├─ TypeConverter.DeserializeArgs("[3,4]", [double, double])
  │  │       │   → [3.0, 4.0]
  │  │       │
  │  │       ├─ func.Invoke([3.0, 4.0])
  │  │       │   → Delegate.DynamicInvoke(3.0, 4.0) → 12.0
  │  │       │
  │  │       ├─ TypeConverter.Serialize(12.0) → "12"
  │  │       │
  │  │       └─ AllocAndCopy("12", outJson, outLen) → returns buffer to C++
  │  │
  │  ├─ Value::createFromJsonUtf8(rt, "12") → JSI Number(12)
  │  │
  │  └─ host->FreeBuffer(resultJson)  → C# Marshal.FreeHGlobal
  │
  └─ JS receives 12
```

### Async call: `await ExampleModule.delayedSquare(5)`

```
JS calls the JSI HostFunction
  │
  ├─ C++ lambda creates a JS Promise via Promise constructor:
  │   new Promise((resolve, reject) => { ... })
  │
  ├─ Inside the executor:
  │   ├─ Captures resolve/reject as shared_ptr<Function>
  │   ├─ Creates AsyncCallbackContext { callInvoker, resolve, reject }
  │   │
  │   └─ host->InvokeAsync(0, "delayedSquare", "[5]",
  │                         AsyncCallbackTrampoline, ctx)
  │       │
  │       └─ Calls C# Expo_InvokeAsync via function pointer
  │           │
  │           ├─ Copies args buffer (caller may free it)
  │           ├─ Fires Task on ThreadPool:
  │           │   InvokeAsyncCore(func, argsCopy, callbackPtr, userDataPtr)
  │           └─ Returns immediately (rc=0)
  │
  ├─ JS receives the Promise (unresolved)
  │
  ╌╌╌ 500ms later, on C# ThreadPool ╌╌╌
  │
  ├─ C# InvokeAsyncCore completes:
  │   ├─ TypeConverter.DeserializeArgs("[5]", [double]) → [5.0]
  │   ├─ await func.InvokeAsync([5.0])
  │   │   → calls async (x) => { await Task.Delay(500); return x * x; }
  │   │   → result = 25.0
  │   ├─ TypeConverter.Serialize(25.0) → "25"
  │   │
  │   └─ Calls C++ callback:
  │       callback(ptr_to_"25", 2, isError=0, userDataPtr)
  │
  ├─ AsyncCallbackTrampoline runs (on C# ThreadPool thread):
  │   ├─ Copies result string, frees C# buffer
  │   │
  │   └─ callInvoker->invokeAsync([resolve, result](Runtime& rt) {
  │         auto val = Value::createFromJsonUtf8(rt, "25");
  │         resolve->call(rt, val);  // resolves the Promise
  │       });
  │
  ╌╌╌ Back on JS thread ╌╌╌
  │
  └─ Promise resolves with 25
      → await returns 25
```

### Events: `module.SendEvent("onStatusChange", data)`

```
C# module calls SendEvent("onStatusChange", new { status = "ready" })
  │
  ├─ Serializes: { moduleIndex: 0, name: "onStatusChange", data: { status: "ready" } }
  │
  └─ Calls C++ event callback via function pointer:
      callback(jsonPtr, jsonLen, userDataPtr)
        │
        ├─ ExpoModuleObject::onEvent (set up during initialization)
        │
        └─ callInvoker->invokeAsync → dispatches to JS thread
            → calls JS listener functions registered via addListener()
```

---

## Data Serialization Summary

All cross-language data is serialized as JSON. This is the MVP approach; a binary protocol is planned for later.

| Direction | What | Format |
|-----------|------|--------|
| JS → C++ | Function arguments | `jsiArgsToJson`: JSI values → JSON array string |
| C++ → C# | Function arguments | UTF-8 JSON byte buffer |
| C# args deserialization | JSON → .NET objects | `TypeConverter.DeserializeArgs`: uses `ParameterTypes` from FunctionDescriptor |
| C# → C++ | Function result | `TypeConverter.Serialize`: .NET object → UTF-8 JSON bytes |
| C++ → JS | Function result | `Value::createFromJsonUtf8`: JSON bytes → JSI value |
| C# → C++ | Module manifest | JSON array of module descriptors |
| C++ parsing | Manifest → ModuleInfo | `nlohmann::json` (vendored, used only at startup) |

---

## Key Design Decisions

**Why HostObject instead of individual TurboModules?**
Matches the iOS/Android Expo Modules architecture. A single TurboModule bootstraps the system; each C# module is a property on the HostObject. This avoids registering N TurboModules with RNW.

**Why JSON marshaling?**
Simplest MVP approach. Both sides already have JSON serializers. Performance is acceptable for module-style APIs (not hot paths). Binary marshaling via source generators is planned for Phase 3.

**Why HostFXR instead of NativeAOT?**
HostFXR loads the full .NET runtime, enabling reflection and `DynamicInvoke`. NativeAOT (Phase 3) will produce self-contained native DLLs but requires source generators to replace reflection. HostFXR is the pragmatic first step.

**Why `callInvoker->invokeAsync` instead of `ExecuteJsi`?**
`ExecuteJsi` silently drops the lambda when called from `REACT_INIT` (the JSI runtime isn't available yet). `callInvoker->invokeAsync` correctly queues the work for when the JS thread is ready.

**Why are module types discovered via codegen, not reflection?**
AOT-compatible from day one. `ExpoModulesProvider.g.cs` lists types explicitly — no assembly scanning needed. This works with both HostFXR (current) and NativeAOT (future).
