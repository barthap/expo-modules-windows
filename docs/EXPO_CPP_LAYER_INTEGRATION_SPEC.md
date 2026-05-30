# Spec: Integrate Expo's Shared C++ Layer

> Date: 2026-05-29
> Status: Implemented (2026-05-30)

## Problem

Our expo-modules-windows-core has a custom C++ runtime layer (ExpoModulesHostObject, ExpoModuleObject) that doesn't match the upstream Expo JS API surface. This means:

- No `EventEmitter` class hierarchy — `addListener` returns undefined instead of a subscription object
- No `SharedObject` / `SharedRef` — can't wrap native handles
- No `LazyObject` — modules are eagerly created as HostObjects
- No `NativeModule` class — `instanceof NativeModule` fails
- No `startObserving` / `stopObserving` lifecycle hooks

The upstream expo-modules-core has a shared `common/cpp/` layer that provides all of this. The [expo-desktop](https://github.com/shirakaba/expo-desktop) project has already patched these files for MSVC compatibility.

## Goal

Replace our custom C++ HostObject layer with Expo's shared C++ layer, while keeping our C# DSL, HostFXR bridge, and autolinking unchanged. This gives us JS API parity with iOS/Android.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source for `common/cpp/` | expo-desktop (SDK 54, MSVC-patched) | Already tested on MSVC, take as-is |
| HostFXR init thread | REACT_INIT thread (before invokeAsync) | Keeps .NET init off JS thread, ~12ms |
| Event bridge | Redesign both C# and C++ | Typed params instead of JSON blob |
| Constants API | Flat top-level properties | Matches upstream iOS/Android |
| Module JS object tracking | In ExpoModulesHostObject | Single owner, simple |
| Event data memory | Copy in trampoline | Zero-alloc C# side, simple lifetime |

---

## Architecture

### Call Flow

```
JS: global.expo.modules.ExampleModule.multiply(3, 4)
  |
  v
ExpoModulesHostObject::get("ExampleModule")     [JSI HostObject]
  |
  v
LazyObject                                       [from common/cpp/]
  |  (first property access triggers init)
  v
NativeModule::createInstance(runtime)            [inherits EventEmitter]
  |
  v
decorateModuleObject(rt, obj, info, host, ci)    [new ExpoModuleDecorator]
  - sync functions   -> JSI HostFunctions        (InvokeSync + JSON marshal)
  - async functions  -> JSI HostFunctions         (InvokeAsync + Promise)
  - constants        -> flat properties           (JSON parse + setProperty per key)
  - startObserving   -> no-op HostFunction        (MVP)
  - stopObserving    -> no-op HostFunction        (MVP)
  - __expo_module_name__ -> string property
  |
  v
JS gets NativeModule instance with EventEmitter on prototype chain
```

### Initialization Sequence

```
REACT_INIT thread:
  1. ExpoModuleHost::InitializeDefault()        // HostFXR + .NET + C# modules

JS thread (callInvoker->invokeAsync):
  2. Create global.expo = {}
  3. EventEmitter::installClass(rt)             -> global.expo.EventEmitter
  4. SharedObject::installBaseClass(rt, noop)    -> global.expo.SharedObject
  5. SharedRef::installBaseClass(rt)             -> global.expo.SharedRef
  6. NativeModule::installClass(rt)              -> global.expo.NativeModule
  7. ExpoModulesHostObject                       -> global.expo.modules
  8. EventBridgeContext + SetEventCallback
```

### Event Flow

```
C#: module.SendEvent("onChange", new { value = 42 })
  |
  v  (ThreadPool thread)
C# callback: (moduleIndex, nameUtf8, nameLen, dataJson, dataLen, userData)
  |
  v  (C++ trampoline, copies strings)
callInvoker->invokeAsync
  |
  v  (JS thread)
Look up module JS object from ExpoModulesHostObject
LazyObject::unwrapObjectIfNecessary
expo::EventEmitter::emitEvent(rt, emitter, "onChange", [{ value: 42 }])
  |
  v
JS listeners fire with subscription lifecycle
```

---

## Components

### 1. Vendored `common/cpp/` (17 files)

**Source**: `https://github.com/shirakaba/expo-desktop` -> `packages/expo-desktop-modules-core/common/cpp/`
**Destination**: `windows/ExpoModulesWindowsCore/common/cpp/`

Files:
- `EventEmitter.h/cpp` — Full event emitter with NativeState, subscriptions, error isolation
- `NativeModule.h/cpp` — JS class inheriting EventEmitter
- `SharedObject.h/cpp` — Reference-counted native handles with GC release
- `SharedRef.h/cpp` — Extends SharedObject
- `LazyObject.h/cpp` — Deferred JSI HostObject initialization
- `JSIUtils.h/cpp` — Class creation, prototype chains, defineProperty
- `ObjectDeallocator.h/cpp` — NativeState-based destructor callbacks
- `TypedArray.h/cpp` — JS TypedArray wrappers
- `BridgelessJSCallInvoker.h` — Async JS call scheduling

No modifications to vendored files. MSVC patches already applied by expo-desktop.

`cxxreact/ErrorUtils.h` dependency resolves via RNW's `React.Cpp.props` which includes `$(ReactNativeDir)\ReactCommon`.

### 2. ExpoModuleDecorator (new)

**Files**: `ExpoModuleDecorator.h`, `ExpoModuleDecorator.cpp`

Free function that takes a NativeModule JS instance and decorates it with C# module manifest data:

```cpp
void decorateModuleObject(
    jsi::Runtime& rt,
    jsi::Object& moduleObj,
    const ModuleInfo& info,
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker);
```

**Sync functions**: For each name in `info.syncFunctions`, create a JSI HostFunction that:
1. Serializes args to JSON via `jsiArgsToJson()`
2. Calls `host.InvokeSync(moduleIdx, funcName, argsJson, &result, &len)`
3. On error: throws `JSError` with extracted message
4. On success: parses result JSON to JSI value via `Value::createFromJsonUtf8()`
5. Frees buffer via `host.FreeBuffer()`
6. Sets function as property: `moduleObj.setProperty(rt, funcName, func)`

**Async functions**: For each name in `info.asyncFunctions`, create a JSI HostFunction that:
1. Serializes args to JSON
2. Creates a Promise with executor
3. Executor creates `AsyncCallbackContext` with resolve/reject
4. Calls `host.InvokeAsync(moduleIdx, funcName, argsJson, &trampoline, ctx)`
5. Sets function as property on module object

**Constants**: Parse `info.constantsJson` as a JS object, iterate its property names, set each as a flat property on `moduleObj`. Uses `Value::createFromJsonUtf8()` to parse the full object, then iterates keys with `getPropertyNames()`.

**Events**: If `info.events` is non-empty, set `startObserving` and `stopObserving` as no-op HostFunctions on the module object. These are called by EventEmitter's `addListener`/`removeListener` when listener count crosses 0.

**Module name**: `moduleObj.setProperty(rt, "__expo_module_name__", info.name)`

### 3. ExpoModulesHostObject (rewritten)

**Files**: `ExpoModulesHostObject.h`, `ExpoModulesHostObject.cpp`

Same role: JSI HostObject on `global.expo.modules`. Rewritten internals:

**Members**:
```cpp
ExpoModuleHost& m_host;
std::shared_ptr<CallInvoker> m_callInvoker;
std::unordered_map<std::string, std::shared_ptr<jsi::Object>> m_moduleCache;      // name -> LazyObject wrapper
std::unordered_map<int, std::shared_ptr<jsi::Object>> m_moduleJsObjects;           // moduleIndex -> decorated obj
```

**`get(rt, name)`**:
1. Check `m_moduleCache` — if found, return cached object
2. Look up `ModuleInfo` from `m_host.FindModule(nameStr)` — if not found, return undefined
3. Create `LazyObject` with initializer lambda that:
   a. Calls `NativeModule::createInstance(rt)`
   b. Calls `decorateModuleObject(rt, obj, info, host, callInvoker)`
   c. Stores `shared_ptr<Object>` in `m_moduleJsObjects[info.index]`
   d. Returns the decorated object
4. Wrap in `Object::createFromHostObject(rt, lazyObj)`, store in `m_moduleCache`, return

**`getModuleJsObject(int moduleIndex)`** — returns pointer from `m_moduleJsObjects`, or nullptr if module hasn't been accessed yet.

**`getPropertyNames(rt)`** — unchanged, returns all module names.

### 4. ExpoEventBridge (new)

**File**: `ExpoEventBridge.h` (header-only, like ExpoAsyncCallback.h)

**EventBridgeContext** — singleton struct, heap-allocated once during init:
```cpp
struct EventBridgeContext {
    std::shared_ptr<CallInvoker> callInvoker;
    ExpoModulesHostObject* hostObject;
    ExpoModuleHost* host;
};
```

**EventCallbackTrampoline** — static `__stdcall` function called from C# ThreadPool thread:

Signature: `(int moduleIndex, uint8_t* eventNameUtf8, int eventNameLen, uint8_t* dataJson, int dataLen, void* userData)`

1. Cast `userData` to `EventBridgeContext*`
2. Copy `eventName` and `data` to `std::string` (buffers are `fixed`-pinned, only valid during call)
3. Capture `callInvoker`, `hostObject` pointer
4. `callInvoker->invokeAsync(...)`:
   a. Get module JS object via `hostObject->getModuleJsObject(moduleIndex)`
   b. If nullptr (module never accessed from JS), silently drop the event
   c. Unwrap via `LazyObject::unwrapObjectIfNecessary(rt, *moduleObj)`
   d. Parse data JSON to `jsi::Value` via `Value::createFromJsonUtf8()`
   e. Call `expo::EventEmitter::emitEvent(rt, emitter, eventName, args.data(), args.size())` (use the `const Object&` overload — the vector overload takes non-const `Object&`)

### 5. Initialization (rewritten)

**File**: `ExpoModulesWindowsCore.cpp`

```
Initialize(reactContext):
  try:
    host = ExpoModuleHost::Instance()
    host.InitializeDefault()                    // .NET on init thread
    callInvoker = reactContext.CallInvoker()
    
    callInvoker->invokeAsync([&host, callInvoker](Runtime& rt):
      // Install class hierarchy
      expo = Object(rt)
      rt.global().setProperty(rt, "expo", expo)
      EventEmitter::installClass(rt)
      SharedObject::installBaseClass(rt, no-op releaser)
      SharedRef::installBaseClass(rt)
      NativeModule::installClass(rt)
      
      // Install modules host object
      hostObj = make_shared<ExpoModulesHostObject>(host, callInvoker)
      expoObj = rt.global().getPropertyAsObject(rt, "expo")
      expoObj.setProperty(rt, "modules", createFromHostObject(rt, hostObj))
      
      // Wire event bridge
      eventCtx = new EventBridgeContext{ callInvoker, hostObj.get(), &host }
      host.SetEventCallback(&EventCallbackTrampoline, eventCtx)
    )
  catch:
    // Set global.expo.__initError (same as current)
```

### 6. C# Event Contract Changes

**`Module.cs`** — `SendEvent()`:
```csharp
public unsafe void SendEvent(string name, object? data = null)
{
    if (EventCallbackPtr == IntPtr.Zero) return;
    
    var nameBytes = Encoding.UTF8.GetBytes(name);
    var dataBytes = data != null ? TypeConverter.Serialize(data) : Array.Empty<byte>();
    
    fixed (byte* namePtr = nameBytes)
    fixed (byte* dataPtr = dataBytes)
    {
        var callback = (delegate* unmanaged<int, byte*, int, byte*, int, IntPtr, void>)EventCallbackPtr;
        callback(ModuleIndex, namePtr, nameBytes.Length, dataPtr, dataBytes.Length, EventUserDataPtr);
    }
}
```

**`NativeEntryPoints.cs`** — `Expo_EmitEvent_SetCallback` export is unchanged (stores opaque function pointer + userData). The C++ trampoline function it points to has the new typed signature.

---

## Files Summary

| File | Action |
|------|--------|
| `windows/ExpoModulesWindowsCore/common/cpp/*` | **NEW** — 17 vendored files |
| `windows/ExpoModulesWindowsCore/ExpoModuleDecorator.h/cpp` | **NEW** |
| `windows/ExpoModulesWindowsCore/ExpoEventBridge.h` | **NEW** |
| `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h/cpp` | **REWRITE** |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp` | **REWRITE** init |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.h` | **MINOR** |
| `windows/ExpoModulesWindowsCore/ExpoModuleObject.h/cpp` | **DELETE** |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj` | **MODIFY** |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters` | **MODIFY** |
| `dotnet/Expo.Modules.Core/Module.cs` | **MODIFY** SendEvent() |
| `dotnet/Expo.Modules.Core/Interop/NativeEntryPoints.cs` | **MINOR** |

---

## What Stays Unchanged

- `ExpoModuleHost.h/cpp` — HostFXR loader, all `Expo_*` wrappers, module metadata parsing
- `ExpoMarshal.h/cpp` — JSON <-> JSI conversion utilities
- `ExpoAsyncCallback.h` — Async callback trampoline for Promise resolution
- `NetHost.props` — MSBuild property sheet for .NET SDK locations
- `vendor/nlohmann/json.hpp` — JSON parser for module definitions
- `dotnet/Expo.Modules.Core/` — All other C# files (ModuleDefinition, FunctionDescriptor, TypeConverter, ViewRegistry, etc.)
- `vendor/expo-modules-autolinking/` — Windows autolinking fork
- Build targets (ExpoManagedDeploy.targets, ExpoExampleDeploy.targets)
- Example module (ExampleModule.cs, ColorBoxModule.cs)

---

## Verification

1. Solution compiles without errors on x64/Debug
2. `global.expo.EventEmitter` / `SharedObject` / `SharedRef` / `NativeModule` exist
3. `global.expo.modules.ExampleModule` returns a NativeModule instance
4. `global.expo.modules.ExampleModule.multiply(3, 4)` returns 12
5. `await global.expo.modules.ExampleModule.delayedSquare(5)` returns 25
6. `global.expo.modules.ExampleModule.platform` === "windows" (flat constant)
7. `global.expo.modules.ExampleModule.addListener("onStatusChange", cb)` returns subscription with `remove()`
8. C# `SendEvent("onStatusChange", new { status = "ok" })` triggers JS listeners
9. Non-existent module access returns `undefined`
10. `ExampleModule instanceof global.expo.NativeModule` === true

---

## Future Work (out of scope)

- **SharedObject for C# objects** — SharedObject releaser calling back into C# to release managed handles
- **startObserving/stopObserving** wired to C# — notify modules when listeners are added/removed
- **NativeAOT support** — binary marshaling instead of JSON
- **expo-modules-core TS compatibility** — verify `requireNativeModule()` from upstream TS package works
