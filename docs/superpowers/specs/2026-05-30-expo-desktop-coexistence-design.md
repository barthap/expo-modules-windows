# Spec: expo-desktop Coexistence

> Date: 2026-05-30
> Status: Approved design

## Problem

When a user installs both `expo-desktop` (for Expo JS runtime support on Windows) and `expo-modules-windows-core` (for C# module support), both libraries compile the same `common/cpp/` layer and both try to install the Expo class hierarchy on `global.expo`. The current init code unconditionally creates `global.expo = {}` and calls `installClasses()`, which would overwrite expo-desktop's setup — destroying its `NativeModulesProxy`, `ExpoAsset`, and `ExponentConstants` stubs that the Expo JS runtime depends on.

## Goal

Make expo-modules-windows-core coexist with expo-desktop in the same RNW project:
- Detect expo-desktop at runtime and skip redundant class hierarchy installation
- Preserve expo-desktop's existing `global.expo` properties
- Merge C# modules into `global.expo.modules` alongside expo-desktop's module stubs
- Continue working standalone (without expo-desktop) exactly as today

## Target Scenario

1. User creates a plain react-native-windows app
2. User installs `expo-desktop` for Expo runtime support on Windows
3. User adds `expo-modules-windows-core` for C# module authoring
4. User writes C# modules or installs C#-based Expo module packages

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Detection mechanism | Runtime JS check | No build-time coupling to expo-desktop. Check if `global.expo.EventEmitter` exists. |
| Class hierarchy | Skip if already installed | Both compile identical `common/cpp/` code. Whoever installs first wins. |
| `global.expo` object | Reuse if exists, create if not | Preserves expo-desktop's properties (NativeModulesProxy stubs, etc.) |
| `global.expo.modules` | Merge via fallback object | Our HostObject checks C# modules first, falls through to expo-desktop's original modules object |
| common/cpp/ compilation | Keep vendoring and compiling | Needed for `emitEvent`, `createInstance`, `LazyObject` — these are .cpp-defined, not header-only |

---

## Architecture

### Init Order

expo-desktop uses `REACT_EAGER_TURBO_MODULE` with `REACT_INIT` that receives `jsi::Runtime&` directly — it runs synchronously during module registration. Our module uses `callInvoker->invokeAsync` which queues work for the JS thread. Therefore expo-desktop always initializes first.

```
1. RNW registers native modules
2. expo-desktop ExpoMainRuntimeInstaller::Initialize(reactContext, runtime)
   - Creates global.expo = { modules: { NativeModulesProxy, ExpoAsset, ExponentConstants } }
   - Calls installClasses() → sets global.expo.EventEmitter, .SharedObject, .SharedRef, .NativeModule
3. Our ExpoModulesWindowsCore::Initialize(reactContext)
   - Loads .NET runtime via HostFXR (REACT_INIT thread)
   - callInvoker->invokeAsync → queued for JS thread
4. Our lambda runs on JS thread:
   - Detects global.expo.EventEmitter exists → skips installClasses()
   - Reuses existing global.expo object
   - Captures existing global.expo.modules as fallback
   - Installs our ExpoModulesHostObject as new global.expo.modules (with fallback)
   - Wires event bridge
```

### Standalone Mode (no expo-desktop)

When expo-desktop is not installed, `global.expo` doesn't exist yet when our lambda runs. The code follows the current path: creates `global.expo`, installs class hierarchy, installs our HostObject. No behavioral change from today.

---

## Components

### 1. Conditional Initialization (`ExpoModulesWindowsCore.cpp`)

The `invokeAsync` lambda changes from unconditional to conditional:

```cpp
callInvoker->invokeAsync([&host, callInvoker](jsi::Runtime& rt) {
    using namespace facebook::jsi;

    // 1. Reuse or create global.expo
    Value expoVal = rt.global().getProperty(rt, "expo");
    bool expoDesktopPresent = false;

    if (expoVal.isObject()) {
        // expo-desktop already set up global.expo
        expoDesktopPresent = true;
    } else {
        // Standalone mode — create global.expo
        Object expo(rt);
        rt.global().setProperty(rt, "expo", expo);
    }

    // 2. Install class hierarchy only if not already present
    if (!expoDesktopPresent) {
        expo::EventEmitter::installClass(rt);
        expo::SharedObject::installBaseClass(rt, [](expo::SharedObject::ObjectId) {});
        expo::SharedRef::installBaseClass(rt);
        expo::NativeModule::installClass(rt);
    }

    // 3. Capture existing modules object (if any) as fallback
    Object expoObj = rt.global().getPropertyAsObject(rt, "expo");
    std::shared_ptr<jsi::Object> fallbackModules;

    if (expoDesktopPresent) {
        Value modulesVal = expoObj.getProperty(rt, "modules");
        if (modulesVal.isObject()) {
            fallbackModules = std::make_shared<Object>(modulesVal.getObject(rt));
        }
    }

    // 4. Install our HostObject (with optional fallback)
    auto hostObj = std::make_shared<ExpoModulesHostObject>(
        host, callInvoker, std::move(fallbackModules));
    expoObj.setProperty(rt, "modules",
        Object::createFromHostObject(rt, hostObj));

    // 5. Wire event bridge (unchanged)
    auto* eventCtx = new EventBridgeContext{ callInvoker, hostObj, &host };
    host.SetEventCallback(
        reinterpret_cast<void*>(&EventCallbackTrampoline),
        reinterpret_cast<void*>(eventCtx));
});
```

The `expoDesktopPresent` check is simply whether `global.expo` already exists as an object. This is reliable because:
- In standalone mode, nothing creates `global.expo` before us
- With expo-desktop, it always creates `global.expo` before our async lambda runs

### 2. ExpoModulesHostObject Fallback (`ExpoModulesHostObject.h/cpp`)

**Header changes** — add optional fallback member and updated constructor:

```cpp
class ExpoModulesHostObject : public facebook::jsi::HostObject {
public:
    ExpoModulesHostObject(ExpoModuleHost& host,
                          std::shared_ptr<facebook::react::CallInvoker> callInvoker,
                          std::shared_ptr<facebook::jsi::Object> fallbackModules = nullptr);
    // ... existing methods unchanged ...

private:
    ExpoModuleHost& m_host;
    std::shared_ptr<facebook::react::CallInvoker> m_callInvoker;
    std::shared_ptr<facebook::jsi::Object> m_fallbackModules;  // NEW
    // ... existing caches ...
};
```

**`get()` changes** — fall through to fallback for unknown names:

```cpp
Value ExpoModulesHostObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check C# module cache
    auto it = m_moduleCache.find(nameStr);
    if (it != m_moduleCache.end()) {
        return Value(rt, *it->second);
    }

    // Check C# module registry
    const ModuleInfo* info = m_host.FindModule(nameStr);
    if (info) {
        // ... existing LazyObject creation logic (unchanged) ...
    }

    // Fall through to expo-desktop's modules (if present)
    if (m_fallbackModules) {
        Value val = m_fallbackModules->getProperty(rt, nameStr.c_str());
        if (!val.isUndefined()) {
            return val;
        }
    }

    return Value::undefined();
}
```

**`getPropertyNames()` changes** — merge both sets:

```cpp
std::vector<PropNameID> ExpoModulesHostObject::getPropertyNames(Runtime& rt) {
    // Start with C# module names
    auto names = /* existing logic */;

    // Merge fallback module names (if present)
    if (m_fallbackModules) {
        Array fallbackNames = m_fallbackModules->getPropertyNames(rt);
        size_t len = fallbackNames.size(rt);
        for (size_t i = 0; i < len; i++) {
            String key = fallbackNames.getValueAtIndex(rt, i).getString(rt);
            std::string keyStr = key.utf8(rt);
            // Only add if not already a C# module (C# takes precedence)
            if (!m_host.FindModule(keyStr)) {
                names.push_back(PropNameID::forString(rt, key));
            }
        }
    }

    return names;
}
```

### 3. Error Path (`ExpoModulesWindowsCore.cpp`)

The catch block also needs to be conditional — if expo-desktop already set up `global.expo`, don't overwrite it with a bare `{ __initError }` object. Instead, set `__initError` on the existing object:

```cpp
catch (const std::exception& ex) {
    m_initError = ex.what();
    auto callInvoker = reactContext.CallInvoker();
    callInvoker->invokeAsync([error = m_initError](jsi::Runtime& rt) {
        using namespace facebook::jsi;
        Value expoVal = rt.global().getProperty(rt, "expo");
        Object expo = expoVal.isObject()
            ? expoVal.getObject(rt)
            : Object(rt);
        expo.setProperty(rt, "__initError",
            String::createFromUtf8(rt, error));
        if (!expoVal.isObject()) {
            rt.global().setProperty(rt, "expo", std::move(expo));
        }
    });
}
```

---

## Files Summary

| File | Change |
|------|--------|
| `ExpoModulesWindowsCore.cpp` | Conditional `global.expo` creation, conditional `installClasses()`, capture fallback modules, update error path |
| `ExpoModulesHostObject.h` | Add `m_fallbackModules` member, update constructor signature |
| `ExpoModulesHostObject.cpp` | Accept fallback in constructor, `get()` falls through to fallback, `getPropertyNames()` merges |

## What Doesn't Change

- `common/cpp/` — stays vendored and compiled (needed for `emitEvent`, `createInstance`, `LazyObject`)
- `ExpoModuleDecorator.h/cpp` — unchanged
- `ExpoEventBridge.h` — unchanged
- `ExpoModuleHost.h/cpp` — unchanged
- `ExpoMarshal.h/cpp` — unchanged
- C# side (`dotnet/Expo.Modules.Core/`) — unchanged
- Autolinking — unchanged

---

## Verification

### Standalone Mode (no expo-desktop)

1. `global.expo` is created by us
2. Class hierarchy installed (`EventEmitter`, `NativeModule`, etc.)
3. `global.expo.modules.ExampleModule.multiply(3, 4)` returns 12
4. Events work via `EventEmitter::emitEvent`
5. No behavioral change from current implementation

### Coexistence Mode (with expo-desktop)

1. `global.expo` is preserved (not overwritten)
2. `global.expo.EventEmitter` exists (installed by expo-desktop)
3. `global.expo.NativeModule` exists (installed by expo-desktop)
4. `global.expo.modules.NativeModulesProxy` exists (expo-desktop stub, via fallback)
5. `global.expo.modules.ExponentConstants` exists (expo-desktop stub, via fallback)
6. `global.expo.modules.ExampleModule.multiply(3, 4)` returns 12 (C# module)
7. C# module takes precedence if name conflicts with expo-desktop stub
8. `Object.keys(global.expo.modules)` includes both C# modules and expo-desktop stubs

---

## Future Work (out of scope)

- **Build-time detection**: MSBuild could detect expo-desktop and set a preprocessor define for compile-time optimizations (e.g., skip compiling unused `installClass` code paths). Not needed for correctness.
- **Shared static lib**: Extract `common/cpp/` into a shared `ExpoCommonCpp.vcxproj` that both projects reference. Requires upstream coordination with shirakaba.
- **Symbol deduplication**: If duplicate symbols in two DLLs ever cause issues (unlikely since they're internal linkage), the shared static lib approach resolves it.
