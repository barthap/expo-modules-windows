# Prompt: C++ ExpoModulesHostObject — JSI Integration

**Agent type:** Plan (then implement)
**Priority:** 2 — requires C# core library (#1)
**Dependencies:** C# Core Library (step 1), HostFXR PoC (done)

---

```
Implement the C++ ExpoModulesHostObject — the single TurboModule that bridges
all C# Expo Modules to JavaScript via a JSI HostObject.

## Context

We're building "expo-modules-windows-core" for React Native Windows.
- HostFXR bridge is proven (docs/HOSTFXR_POC_RESULTS.md)
- C# core library exists at dotnet/Expo.Modules.Core/ with interop entry points
- Expo Modules use a SINGLE TurboModule + JSI HostObject (not per-module TurboModules)

## Repository

D:\dev\expo-modules-windows-core
- windows/ExpoModulesWindowsCore/ — existing C++ TurboModule project
- dotnet/Expo.Modules.Core/ — C# core library with [UnmanagedCallersOnly] exports
- test/hostfxr-poc/ — working HostFXR loader reference code

## Architecture

```
JS: global.expo.modules.Math.add(2, 3)
         │
         ▼
ExpoModulesHostObject (jsi::HostObject)
  get("Math") → ExpoModuleObject for "Math"
         │
         ▼
ExpoModuleObject (jsi::HostObject)
  get("add") → jsi::Function wrapper
         │
         ▼
jsi::Function calls C# via HostFXR:
  Expo_InvokeSync(moduleIdx=0, funcName="add", args="[2,3]")
         │
         ▼
C# MathModule.add(2, 3) → returns 5
         │
         ▼
JS receives: 5
```

## C# Interop Contract (from Expo.Modules.Core)

```c
// Discovery
int  Expo_Initialize(byte* moduleTypesJson, int len);
int  Expo_GetModuleCount();
int  Expo_GetModuleDefinitions(byte** outJson, int* outLen);

// Invocation
int  Expo_InvokeSync(int moduleIdx, byte* funcName, int funcNameLen,
                      byte* argsJson, int argsLen,
                      byte** resultJson, int* resultLen);
int  Expo_InvokeAsync(int moduleIdx, byte* funcName, int funcNameLen,
                       byte* argsJson, int argsLen, void* callbackPtr);

// Events
void Expo_EmitEvent_SetCallback(void* callbackPtr);

// Memory
void Expo_FreeBuffer(byte* ptr);
```

## What to implement

### 1. ExpoModuleHost.h/cpp — .NET Runtime Loader
Adapt from test/hostfxr-poc/main.cpp:
- `bool Initialize(const std::wstring& assemblyDir)` — loads HostFXR, initializes .NET
- Resolves all Expo_* function pointers once at startup
- Calls `Expo_Initialize` with module class list (from autolinking)
- Calls `Expo_GetModuleDefinitions` to get JSON module metadata
- Parses module metadata into C++ structs for fast lookup
- Singleton pattern — one instance per app

### 2. ExpoModulesHostObject.h/cpp — Top-level JSI HostObject
Installed on `global.expo.modules` (or `global.ExpoModules`):
- `get(runtime, propName)`:
  - Lookup propName in module name map
  - If found → return cached ExpoModuleObject
  - If not found → return undefined
- `getPropertyNames(runtime)`:
  - Return list of all module names
- Caches ExpoModuleObject instances (created lazily on first access)

### 3. ExpoModuleObject.h/cpp — Per-module JSI HostObject
One per C# module (e.g., "Math"):
- Constructed with: module index, module metadata (function names, constants, events)
- `get(runtime, propName)`:
  - If propName is a sync function name → return jsi::Function that calls Expo_InvokeSync
  - If propName is an async function name → return jsi::Function that returns Promise
  - If propName is a constant name → return cached jsi::Value
  - If propName is "addListener" → return event subscription function
- `getPropertyNames(runtime)`:
  - Return all function names + constant names + event methods

### 4. Sync function dispatch
```cpp
jsi::Function::createFromHostFunction(rt, name, argCount,
    [this, moduleIdx, funcName](Runtime& rt, const Value& thisVal,
                                 const Value* args, size_t count) -> Value {
        // 1. Serialize args to JSON
        std::string argsJson = jsiArgsToJson(rt, args, count);
        // 2. Call C# via Expo_InvokeSync
        byte* resultJson; int resultLen;
        int rc = m_host->InvokeSync(moduleIdx, funcName,
                                      argsJson.data(), argsJson.size(),
                                      &resultJson, &resultLen);
        // 3. Parse result JSON to jsi::Value
        auto result = jsonToJsiValue(rt, resultJson, resultLen);
        m_host->FreeBuffer(resultJson);
        // 4. Check for error
        if (rc != 0) throw jsi::JSError(rt, /* error from result */);
        return result;
    });
```

### 5. Async function dispatch (Promise)
```cpp
// Return a Promise
auto promise = createPromise(rt, [this, moduleIdx, funcName, argsJson](
    Runtime& rt, std::shared_ptr<PromiseWrapper> pw) {
        // Call C# async — provides callback pointer
        m_host->InvokeAsync(moduleIdx, funcName,
                            argsJson.data(), argsJson.size(),
                            pw->getCallbackPtr());
        // C# will call back when done — callback posts to JS thread
    });
return promise;
```

The callback from C# needs to:
1. Receive result JSON + isError flag
2. Post to JS thread (via ReactContext.JSDispatcher or CallInvoker)
3. Resolve or reject the Promise

### 6. Event system
- During init, call `Expo_EmitEvent_SetCallback` with a C++ callback function
- When C# calls SendEvent → callback fires with (moduleIdx, eventName, dataJson)
- C++ callback posts to JS thread → emits event via EventEmitter pattern
- JS side: `ExpoModules.Math.addListener("onResult", callback)`

### 7. Registration with RNW
Modify existing ExpoModulesWindowsCore TurboModule:
- In `Initialize()`: create ExpoModuleHost, load .NET, discover modules
- Install HostObject: `runtime.global().setProperty(runtime, "ExpoModules", hostObject)`
- Or nest under `global.expo.modules` to match iOS/Android convention

### 8. JSON ↔ JSI Marshaling (ExpoMarshal.h/cpp)
- `std::string jsiArgsToJson(Runtime& rt, const Value* args, size_t count)`
  Converts JSI args to JSON array string: `[arg1, arg2, ...]`
- `jsi::Value jsonToJsiValue(Runtime& rt, const char* json, size_t len)`
  Parses JSON string into JSI Value (number, string, object, array, null)
- Use folly::dynamic (already available in RNW) or a lightweight JSON parser

## Threading Model
- JS calls arrive on the JS thread
- Sync Expo_InvokeSync: blocks JS thread (acceptable, same as iOS/Android Expo)
- Async Expo_InvokeAsync: C# runs on ThreadPool, callbacks post to JS thread
- Event callbacks from C#: post to JS thread before emitting

## Constraints
- Must work with RNW 0.81+ New Architecture (Win32 + Windows App SDK)
- Use existing RNW infrastructure (ReactContext, JSDispatcher, CallInvoker)
- No dynamic TurboModule registration — single REACT_MODULE is sufficient
- Memory: C# allocates buffers, C++ reads, then calls Expo_FreeBuffer

## Output
Write actual C++ code. Modify the existing .vcxproj as needed.
Include the HostFXR loader, HostObject classes, and JSON marshaling.
```
