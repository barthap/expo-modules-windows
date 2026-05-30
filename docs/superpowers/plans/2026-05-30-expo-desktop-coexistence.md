# expo-desktop Coexistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make expo-modules-windows-core detect expo-desktop at runtime and adapt initialization — skip redundant class hierarchy installation, preserve existing `global.expo` properties, and merge C# modules alongside expo-desktop's module stubs.

**Architecture:** At init time, check whether `global.expo` already exists (set up by expo-desktop's `REACT_EAGER_TURBO_MODULE`). If it does, skip `installClasses()` and capture the existing `global.expo.modules` object as a fallback. Our `ExpoModulesHostObject::get()` checks C# modules first, then falls through to the fallback. Standalone mode (no expo-desktop) is unchanged.

**Tech Stack:** C++/WinRT, JSI, React Native Windows 0.81

**Spec:** `docs/superpowers/specs/2026-05-30-expo-desktop-coexistence-design.md`

---

### Task 1: Update ExpoModulesHostObject to accept a fallback modules object

**Files:**
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h`
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp`

This task adds the `m_fallbackModules` member and updates the constructor, `get()`, and `getPropertyNames()` to support merging with an existing modules object from expo-desktop.

- [ ] **Step 1: Update the header — add fallback member and update constructor**

Replace the full content of `ExpoModulesHostObject.h` with:

```cpp
// ExpoModulesHostObject.h — Top-level JSI HostObject on global.expo.modules.
// Maps module names to LazyObject-wrapped NativeModule instances.
// When expo-desktop is present, falls through to its modules for unknown names.

#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <jsi/jsi.h>
#include "ExpoModuleHost.h"

namespace facebook::react {
class CallInvoker;
}

namespace expo {

class ExpoModulesHostObject : public facebook::jsi::HostObject {
public:
    ExpoModulesHostObject(ExpoModuleHost& host,
                          std::shared_ptr<facebook::react::CallInvoker> callInvoker,
                          std::shared_ptr<facebook::jsi::Object> fallbackModules = nullptr);

    facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                             const facebook::jsi::PropNameID& name) override;

    std::vector<facebook::jsi::PropNameID> getPropertyNames(
        facebook::jsi::Runtime& rt) override;

    // Returns the decorated JS object for a module by index, or nullptr
    // if the module hasn't been accessed from JS yet.
    facebook::jsi::Object* getModuleJsObject(int moduleIndex);

private:
    ExpoModuleHost& m_host;
    std::shared_ptr<facebook::react::CallInvoker> m_callInvoker;

    // When expo-desktop is installed, holds a reference to its original
    // global.expo.modules object. get() falls through to this for names
    // that aren't C# modules. nullptr in standalone mode.
    std::shared_ptr<facebook::jsi::Object> m_fallbackModules;

    // All map access must occur on the JS thread (get() via JSI, getModuleJsObject()
    // via callInvoker->invokeAsync). No mutex needed.
    std::unordered_map<std::string, std::shared_ptr<facebook::jsi::Object>> m_moduleCache;
    std::unordered_map<int, std::shared_ptr<facebook::jsi::Object>> m_moduleJsObjects;
};

} // namespace expo
```

- [ ] **Step 2: Update the constructor in ExpoModulesHostObject.cpp**

Replace the constructor (lines 13-17 of ExpoModulesHostObject.cpp):

```cpp
ExpoModulesHostObject::ExpoModulesHostObject(
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker,
    std::shared_ptr<facebook::jsi::Object> fallbackModules)
    : m_host(host)
    , m_callInvoker(std::move(callInvoker))
    , m_fallbackModules(std::move(fallbackModules)) {}
```

- [ ] **Step 3: Update `get()` to fall through to fallback**

Replace the `get()` method (lines 19-60 of ExpoModulesHostObject.cpp):

```cpp
Value ExpoModulesHostObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check cache
    auto it = m_moduleCache.find(nameStr);
    if (it != m_moduleCache.end()) {
        return Value(rt, *it->second);
    }

    // Look up module by name
    const ModuleInfo* info = m_host.FindModule(nameStr);
    if (info) {
        // Capture everything the LazyObject initializer needs
        ModuleInfo infoCopy = *info;
        ExpoModuleHost* host = &m_host;
        auto callInvoker = m_callInvoker;
        auto* self = this;

        // Create LazyObject — defers NativeModule creation until first property access
        auto lazyObj = std::make_shared<LazyObject>(
            [host, infoCopy, callInvoker, self](Runtime& rt) -> std::shared_ptr<Object> {
                // Create a NativeModule instance (inherits EventEmitter)
                Object moduleObj = expo::NativeModule::createInstance(rt);

                // Decorate with functions, constants, events from the C# manifest
                decorateModuleObject(rt, moduleObj, infoCopy, *host, callInvoker);

                // Store the decorated object for event dispatch
                auto sharedObj = std::make_shared<Object>(std::move(moduleObj));
                self->m_moduleJsObjects[infoCopy.index] = sharedObj;

                return sharedObj;
            });

        // Wrap LazyObject as JSI object, cache, and return
        auto jsObj = std::make_shared<Object>(Object::createFromHostObject(rt, lazyObj));
        m_moduleCache[nameStr] = jsObj;
        return Value(rt, *jsObj);
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

- [ ] **Step 4: Update `getPropertyNames()` to merge fallback names**

Replace the `getPropertyNames()` method (lines 62-68 of ExpoModulesHostObject.cpp):

```cpp
std::vector<PropNameID> ExpoModulesHostObject::getPropertyNames(Runtime& rt) {
    std::vector<PropNameID> names;
    for (const auto& mod : m_host.GetModules()) {
        names.push_back(PropNameID::forUtf8(rt, mod.name));
    }

    // Merge fallback module names (expo-desktop stubs like NativeModulesProxy)
    if (m_fallbackModules) {
        Array fallbackNames = m_fallbackModules->getPropertyNames(rt);
        size_t len = fallbackNames.size(rt);
        for (size_t i = 0; i < len; i++) {
            String key = fallbackNames.getValueAtIndex(rt, i).getString(rt);
            std::string keyStr = key.utf8(rt);
            // C# modules take precedence — only add if not already a C# module
            if (!m_host.FindModule(keyStr)) {
                names.push_back(PropNameID::forString(rt, key));
            }
        }
    }

    return names;
}
```

- [ ] **Step 5: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp
git commit -m "feat: add fallback modules support to ExpoModulesHostObject

When expo-desktop is present, get() falls through to its original
modules object for names that aren't C# modules. getPropertyNames()
returns the union of both."
```

---

### Task 2: Rewrite initialization to detect expo-desktop and adapt

**Files:**
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp`

This task updates the `Initialize()` method to conditionally create `global.expo`, conditionally install the class hierarchy, capture the existing modules object as fallback, and fix the error path to not clobber expo-desktop's setup.

- [ ] **Step 1: Rewrite the invokeAsync lambda (happy path)**

Replace lines 30-60 of `ExpoModulesWindowsCore.cpp` (the entire `callInvoker->invokeAsync` lambda) with:

```cpp
        callInvoker->invokeAsync([&host, callInvoker](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;

            // 1. Detect whether expo-desktop already set up global.expo
            Value expoVal = rt.global().getProperty(rt, "expo");
            bool expoDesktopPresent = expoVal.isObject();

            if (!expoDesktopPresent) {
                // Standalone mode — create global.expo
                Object expo(rt);
                rt.global().setProperty(rt, "expo", expo);
            }

            // 2. Install class hierarchy only if expo-desktop hasn't already
            if (!expoDesktopPresent) {
                expo::EventEmitter::installClass(rt);
                expo::SharedObject::installBaseClass(rt, [](expo::SharedObject::ObjectId) {});
                expo::SharedRef::installBaseClass(rt);
                expo::NativeModule::installClass(rt);
            }

            // 3. Capture existing modules object as fallback (expo-desktop stubs)
            Object expoObj = rt.global().getPropertyAsObject(rt, "expo");
            std::shared_ptr<Object> fallbackModules;

            if (expoDesktopPresent) {
                Value modulesVal = expoObj.getProperty(rt, "modules");
                if (modulesVal.isObject()) {
                    fallbackModules = std::make_shared<Object>(modulesVal.getObject(rt));
                }
            }

            // 4. Install modules host object (with optional fallback)
            auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(
                host, callInvoker, std::move(fallbackModules));
            expoObj.setProperty(rt, "modules",
                Object::createFromHostObject(rt, hostObj));

            // 5. Wire up event bridge
            auto* eventCtx = new expo::EventBridgeContext{
                callInvoker, hostObj, &host
            };
            host.SetEventCallback(
                reinterpret_cast<void*>(&expo::EventCallbackTrampoline),
                reinterpret_cast<void*>(eventCtx));
        });
```

- [ ] **Step 2: Fix the error path to preserve expo-desktop's global.expo**

Replace the catch block (lines 62-73 of the original file) with:

```cpp
    catch (const std::exception& ex) {
        m_initError = ex.what();
        auto callInvoker = reactContext.CallInvoker();
        callInvoker->invokeAsync([error = m_initError](facebook::jsi::Runtime& rt) {
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

- [ ] **Step 3: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp
git commit -m "feat: detect expo-desktop at runtime and adapt initialization

- Reuse existing global.expo if expo-desktop created it
- Skip installClasses() when class hierarchy already installed
- Capture expo-desktop's modules object as fallback
- Error path preserves existing global.expo instead of clobbering"
```

---

### Task 3: Build verification and update docs

**Files:**
- Modify: `docs/EXPO_DESKTOP.md`
- Modify: `docs/CODE_FLOW.md`

- [ ] **Step 1: Build the solution**

Open `example/windows/ExpoModulesWindowsCoreExample.sln` in Visual Studio 2022 and build (x64/Debug). Verify zero errors. The warnings about `#pragma mark` (C4068) and unreferenced parameters (C4100) from vendored files are expected and harmless.

- [ ] **Step 2: Run the example app**

Launch the example app and verify standalone mode still works:
- Sync functions work: `global.expo.modules.ExampleModule.multiply(3, 4)` returns 12
- Constants work: `ExampleModule.platform` is "windows"
- Events work: "Send Event from C#" triggers the listener
- Class hierarchy exists: `global.expo.EventEmitter` is defined

- [ ] **Step 3: Update docs/EXPO_DESKTOP.md — add coexistence section**

Add the following section before the "Updating the Vendored Files" section in `docs/EXPO_DESKTOP.md`:

```markdown
## Coexistence Mode

When expo-desktop is installed in the same RNW project, our library detects it automatically at runtime and adapts:

1. **Detection**: Checks whether `global.expo` already exists when our init lambda runs. expo-desktop uses `REACT_EAGER_TURBO_MODULE` (synchronous init), so it always runs before our `callInvoker->invokeAsync`.

2. **Class hierarchy**: Skipped — expo-desktop already installed `EventEmitter`, `NativeModule`, `SharedObject`, `SharedRef` on `global.expo`. Both DLLs compile identical `common/cpp/` code, so the classes are interchangeable.

3. **Module merging**: expo-desktop sets up `global.expo.modules` with stubs (`NativeModulesProxy`, `ExpoAsset`, `ExponentConstants`). We capture that object as a fallback and replace `global.expo.modules` with our `ExpoModulesHostObject`. When JS accesses a module name that isn't a C# module, our HostObject falls through to the original expo-desktop object.

No build-time configuration is needed — the detection is fully automatic.
```

- [ ] **Step 4: Update docs/CODE_FLOW.md — note coexistence in init section**

In the "Phase 3: Class Hierarchy + HostObject Installation" section, after the `callInvoker->invokeAsync` code block, add:

```markdown
When expo-desktop is also installed, this lambda detects `global.expo` already exists and adapts: it skips class hierarchy installation (expo-desktop already did it) and captures the existing `global.expo.modules` as a fallback for module name resolution. See [EXPO_DESKTOP.md](EXPO_DESKTOP.md) for details.
```

- [ ] **Step 5: Commit**

```bash
git add docs/EXPO_DESKTOP.md docs/CODE_FLOW.md
git commit -m "docs: document expo-desktop coexistence mode"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Runtime JS detection of expo-desktop | Task 2, Step 1 (`expoVal.isObject()`) |
| Skip class hierarchy if already installed | Task 2, Step 1 (`if (!expoDesktopPresent)`) |
| Preserve existing `global.expo` | Task 2, Step 1 (reuse instead of create) |
| Capture existing modules as fallback | Task 2, Step 1 (`fallbackModules`) |
| `get()` falls through to fallback | Task 1, Step 3 |
| `getPropertyNames()` merges both | Task 1, Step 4 |
| C# modules take precedence | Task 1, Step 3 (checked before fallback) and Step 4 (`FindModule` check) |
| Error path preserves `global.expo` | Task 2, Step 2 |
| Standalone mode unchanged | Task 2, Step 1 (`if (!expoDesktopPresent)` gates) |
| Constructor updated | Task 1, Steps 1-2 |
| Verification | Task 3, Steps 1-2 |
| Doc updates | Task 3, Steps 3-4 |

**No gaps found.** All spec requirements are covered.

**Placeholder scan:** No TBDs, TODOs, or vague instructions found.

**Type consistency:** Constructor signature `(ExpoModuleHost&, shared_ptr<CallInvoker>, shared_ptr<Object>)` matches in header (Task 1 Step 1), implementation (Task 1 Step 2), and call site (Task 2 Step 1). `m_fallbackModules` type is consistent throughout.
