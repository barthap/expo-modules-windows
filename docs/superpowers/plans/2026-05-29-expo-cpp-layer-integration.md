# Expo Shared C++ Layer Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom C++ HostObject layer (ExpoModuleObject) with Expo's shared C++ layer (EventEmitter, NativeModule, SharedObject, LazyObject) from expo-desktop, giving us JS API parity with iOS/Android while keeping the C# DSL and HostFXR bridge.

**Architecture:** A single TurboModule bootstraps. On the JS thread it installs the class hierarchy (EventEmitter → NativeModule, SharedObject → SharedRef) on `global.expo`, then installs `ExpoModulesHostObject` on `global.expo.modules`. Each module is a `LazyObject` wrapping a `NativeModule` instance decorated with C# manifest data (functions, constants, events) via a new `decorateModuleObject()` function. Events flow from C# through a typed callback trampoline → `callInvoker->invokeAsync` → `expo::EventEmitter::emitEvent()`.

**Tech Stack:** C++/WinRT, JSI, React Native Windows 0.81, .NET 9 via HostFXR, MSVC v143

**Spec:** `docs/EXPO_CPP_LAYER_INTEGRATION_SPEC.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `windows/ExpoModulesWindowsCore/common/cpp/*.h/*.cpp` | **NEW** (17 vendored files) | Expo's shared C++ runtime classes |
| `windows/ExpoModulesWindowsCore/ExpoModuleDecorator.h` | **NEW** | Header for `decorateModuleObject()` |
| `windows/ExpoModulesWindowsCore/ExpoModuleDecorator.cpp` | **NEW** | Decorates NativeModule instances with C# manifest data |
| `windows/ExpoModulesWindowsCore/ExpoEventBridge.h` | **NEW** | Event callback trampoline + EventBridgeContext |
| `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h` | **REWRITE** | LazyObject cache + module JS object tracking |
| `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp` | **REWRITE** | Uses LazyObject + decorator instead of ExpoModuleObject |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp` | **REWRITE** | Installs class hierarchy, wires event bridge |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.h` | **MINOR** | No functional changes needed |
| `windows/ExpoModulesWindowsCore/ExpoModuleObject.h` | **DELETE** | Replaced by ExpoModuleDecorator |
| `windows/ExpoModulesWindowsCore/ExpoModuleObject.cpp` | **DELETE** | Replaced by ExpoModuleDecorator |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj` | **MODIFY** | Add/remove files, include paths |
| `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters` | **MODIFY** | Update file filters |
| `dotnet/Expo.Modules.Core/Module.cs` | **MODIFY** | New SendEvent() callback signature |

### Unchanged files
- `ExpoModuleHost.h/cpp` — HostFXR singleton, `SetEventCallback()` is already opaque
- `ExpoMarshal.h/cpp` — JSON ↔ JSI conversion
- `ExpoAsyncCallback.h` — Async callback trampoline for Promise resolution
- `ExpoViewManager.h/cpp` — View system
- `pch.h/cpp` — Precompiled header
- All other C# files, autolinking, build targets

---

### Task 1: Vendor `common/cpp/` from expo-desktop

**Files:**
- Create: `windows/ExpoModulesWindowsCore/common/cpp/JSIUtils.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/JSIUtils.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/ObjectDeallocator.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/ObjectDeallocator.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/EventEmitter.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/EventEmitter.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/NativeModule.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/NativeModule.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/SharedObject.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/SharedObject.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/SharedRef.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/SharedRef.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/LazyObject.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/LazyObject.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/TypedArray.h`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/TypedArray.cpp`
- Create: `windows/ExpoModulesWindowsCore/common/cpp/BridgelessJSCallInvoker.h`

These 17 files come verbatim from `https://github.com/shirakaba/expo-desktop` at `packages/expo-desktop-modules-core/common/cpp/`. They are already MSVC-patched (`#import` → `#include`, `<functional>` added). Do NOT modify vendored files.

- [ ] **Step 0: Pre-flight — verify `cxxreact/ErrorUtils.h` resolves**

The vendored `EventEmitter.cpp` includes `<cxxreact/ErrorUtils.h>`. This must resolve via RNW's include paths. Verify before vendoring:

```bash
# Find ErrorUtils.h in the RNW dependency tree
find "$(node -p "require('react-native-windows/package.json') && require('path').dirname(require.resolve('react-native/package.json'))")/ReactCommon" -name "ErrorUtils.h" 2>/dev/null
```

Expected: A path like `node_modules/react-native/ReactCommon/cxxreact/ErrorUtils.h`. If not found, check `node_modules/react-native-windows/` for the header — RNW may bundle its own copy.

If the header doesn't exist at all, stop and investigate before proceeding — the vendored EventEmitter.cpp will fail to compile.

- [ ] **Step 1: Download vendored files from expo-desktop**

Clone or fetch the files from the expo-desktop repository. The files are located at `packages/expo-desktop-modules-core/common/cpp/` in the `main` branch.

```bash
cd D:/dev/expo-modules-windows-core
mkdir -p windows/ExpoModulesWindowsCore/common/cpp

# Clone expo-desktop to a temp dir and copy the files
git clone --depth 1 https://github.com/shirakaba/expo-desktop /tmp/expo-desktop
cp /tmp/expo-desktop/packages/expo-desktop-modules-core/common/cpp/* windows/ExpoModulesWindowsCore/common/cpp/
rm -rf /tmp/expo-desktop
```

Expected: 17 files (9 `.h` + 8 `.cpp`) in `windows/ExpoModulesWindowsCore/common/cpp/`.

- [ ] **Step 2: Verify all expected files are present**

```bash
ls windows/ExpoModulesWindowsCore/common/cpp/
```

Expected output (alphabetically):
```
BridgelessJSCallInvoker.h
EventEmitter.cpp
EventEmitter.h
JSIUtils.cpp
JSIUtils.h
LazyObject.cpp
LazyObject.h
NativeModule.cpp
NativeModule.h
ObjectDeallocator.cpp
ObjectDeallocator.h
SharedObject.cpp
SharedObject.h
SharedRef.cpp
SharedRef.h
TypedArray.cpp
TypedArray.h
```

If `TestingSyncJSCallInvoker.h` was copied, delete it — it's test-only and not needed.

- [ ] **Step 3: Verify MSVC compatibility markers**

Spot-check that MSVC patches are present:

```bash
# Should NOT find #import (Apple-only directive)
grep -r '#import' windows/ExpoModulesWindowsCore/common/cpp/ || echo "OK: no #import found"

# Should find #include <functional> in files that use std::function
grep -l '#include <functional>' windows/ExpoModulesWindowsCore/common/cpp/
```

Expected: No `#import` directives. `<functional>` should be present in files using `std::function` (e.g., `SharedObject.h`, `LazyObject.h`).

- [ ] **Step 4: Commit vendored files**

```bash
git add windows/ExpoModulesWindowsCore/common/cpp/
git commit -m "vendor: add Expo shared C++ layer from expo-desktop (SDK 54, MSVC-patched)"
```

---

### Task 2: Update vcxproj — add vendored files and include path

**Files:**
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj`
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters`

- [ ] **Step 1: Add `common/cpp/` to include paths**

In `ExpoModulesWindowsCore.vcxproj`, add `$(MSBuildThisFileDirectory)common\cpp;` to `AdditionalIncludeDirectories` (line 84). Change:

```xml
      <AdditionalIncludeDirectories>
        $(MSBuildThisFileDirectory);
        $(MSBuildThisFileDirectory)vendor;
        $(NetHostDir);
        %(AdditionalIncludeDirectories)
      </AdditionalIncludeDirectories>
```

To:

```xml
      <AdditionalIncludeDirectories>
        $(MSBuildThisFileDirectory);
        $(MSBuildThisFileDirectory)common\cpp;
        $(MSBuildThisFileDirectory)vendor;
        $(NetHostDir);
        %(AdditionalIncludeDirectories)
      </AdditionalIncludeDirectories>
```

- [ ] **Step 2: Add vendored .cpp files as ClCompile items**

In the `<ItemGroup>` containing `<ClCompile>` entries (around line 125), add the vendored .cpp files. These files do NOT use our Windows precompiled header (`pch.h`), so each must have `<PrecompiledHeader>NotUsing</PrecompiledHeader>`:

```xml
    <!-- Vendored Expo common/cpp/ (no PCH — these are cross-platform files) -->
    <ClCompile Include="common\cpp\JSIUtils.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\ObjectDeallocator.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\EventEmitter.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\NativeModule.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\SharedObject.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\SharedRef.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\LazyObject.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
    <ClCompile Include="common\cpp\TypedArray.cpp">
      <PrecompiledHeader>NotUsing</PrecompiledHeader>
    </ClCompile>
```

- [ ] **Step 3: Add vendored .h files as ClInclude items**

In the `<ItemGroup>` containing `<ClInclude>` entries (around line 110), add:

```xml
    <!-- Vendored Expo common/cpp/ headers -->
    <ClInclude Include="common\cpp\JSIUtils.h" />
    <ClInclude Include="common\cpp\ObjectDeallocator.h" />
    <ClInclude Include="common\cpp\EventEmitter.h" />
    <ClInclude Include="common\cpp\NativeModule.h" />
    <ClInclude Include="common\cpp\SharedObject.h" />
    <ClInclude Include="common\cpp\SharedRef.h" />
    <ClInclude Include="common\cpp\LazyObject.h" />
    <ClInclude Include="common\cpp\TypedArray.h" />
    <ClInclude Include="common\cpp\BridgelessJSCallInvoker.h" />
```

- [ ] **Step 4: Update vcxproj.filters**

Add a new filter group for vendored files. In `ExpoModulesWindowsCore.vcxproj.filters`, add a filter:

```xml
  <ItemGroup>
    <Filter Include="Source Files">
      <UniqueIdentifier>{4FC737F1-C7A5-4376-A066-2A32D752A2FF}</UniqueIdentifier>
      <Extensions>cpp;c;cc;cxx;def;odl;idl;hpj;bat;asm;asmx</Extensions>
    </Filter>
    <Filter Include="Header Files">
      <UniqueIdentifier>{93995380-89BD-4b04-88EB-625FBE52EBFB}</UniqueIdentifier>
      <Extensions>h;hh;hpp;hxx;hm;inl;inc;ipp;xsd</Extensions>
    </Filter>
    <Filter Include="Resource Files">
      <UniqueIdentifier>{67DA6AB6-F800-4c08-8B7A-83BB121AAD01}</UniqueIdentifier>
      <Extensions>rc;ico;cur;bmp;dlg;rc2;rct;bin;rgs;gif;jpg;jpeg;jpe;resx;tiff;tif;png;wav;mfcribbon-ms</Extensions>
    </Filter>
    <Filter Include="Expo Common">
      <UniqueIdentifier>{B2E3A1F0-1234-5678-9ABC-DEF012345678}</UniqueIdentifier>
    </Filter>
  </ItemGroup>
```

And add the file entries to the appropriate item groups:

```xml
  <ItemGroup>
    <!-- existing headers ... -->
    <ClInclude Include="common\cpp\JSIUtils.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\ObjectDeallocator.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\EventEmitter.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\NativeModule.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\SharedObject.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\SharedRef.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\LazyObject.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\TypedArray.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
    <ClInclude Include="common\cpp\BridgelessJSCallInvoker.h">
      <Filter>Expo Common</Filter>
    </ClInclude>
  </ItemGroup>
  <ItemGroup>
    <!-- existing sources ... -->
    <ClCompile Include="common\cpp\JSIUtils.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\ObjectDeallocator.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\EventEmitter.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\NativeModule.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\SharedObject.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\SharedRef.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\LazyObject.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
    <ClCompile Include="common\cpp\TypedArray.cpp">
      <Filter>Expo Common</Filter>
    </ClCompile>
  </ItemGroup>
```

- [ ] **Step 5: Verify solution compiles**

Open in VS 2022 or run:

```bash
# From the example app solution directory
MSBuild.exe example/windows/ExpoModulesExample.sln /p:Platform=x64 /p:Configuration=Debug /t:Build /p:BuildProjectReferences=true
```

Expected: Compilation succeeds. The vendored files compile standalone (no PCH dependency). The `#include <cxxreact/ErrorUtils.h>` in `EventEmitter.cpp` resolves via RNW's include paths.

**Potential issues:**
- If `cxxreact/ErrorUtils.h` is not found, verify that `Microsoft.ReactNative.CppLib.props` adds `$(ReactNativeDir)\ReactCommon` to include paths. This should already be the case.
- If vendored files reference headers with `""` includes that assume being in a subdirectory, the `common\cpp` include path we added should resolve them.

- [ ] **Step 6: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters
git commit -m "build: add vendored common/cpp/ to vcxproj with NotUsing PCH"
```

---

### Task 3: Create `ExpoModuleDecorator.h/cpp`

**Files:**
- Create: `windows/ExpoModulesWindowsCore/ExpoModuleDecorator.h`
- Create: `windows/ExpoModulesWindowsCore/ExpoModuleDecorator.cpp`

This replaces `ExpoModuleObject`. Instead of a HostObject that intercepts `get()`, it's a free function that sets properties directly on a `NativeModule` JS instance.

- [ ] **Step 1: Create `ExpoModuleDecorator.h`**

```cpp
// ExpoModuleDecorator.h — Decorates a NativeModule JS instance with
// functions, constants, and events from a C# module manifest.

#pragma once

#include <memory>
#include <jsi/jsi.h>
#include "ExpoModuleHost.h"

namespace facebook::react {
class CallInvoker;
}

namespace expo {

void decorateModuleObject(
    facebook::jsi::Runtime& rt,
    facebook::jsi::Object& moduleObj,
    const ModuleInfo& info,
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker);

} // namespace expo
```

- [ ] **Step 2: Create `ExpoModuleDecorator.cpp`**

This file reuses the sync/async function creation logic from the old `ExpoModuleObject.cpp`, but sets properties on the passed-in `moduleObj` rather than intercepting `get()`.

```cpp
// ExpoModuleDecorator.cpp — Decorates NativeModule instances with C# manifest data.

#include "pch.h"
#include "ExpoModuleDecorator.h"
#include "ExpoMarshal.h"
#include "ExpoAsyncCallback.h"

#include <ReactCommon/CallInvoker.h>

namespace expo {

using namespace facebook::jsi;

static Function createSyncHostFunction(
    Runtime& rt,
    const std::string& funcName,
    int moduleIdx,
    ExpoModuleHost* host)
{
    return Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0,
        [host, moduleIdx, funcName](Runtime& rt, const Value& thisVal,
                                     const Value* args, size_t count) -> Value {
            std::string argsJson = jsiArgsToJson(rt, args, count);

            uint8_t* resultJson = nullptr;
            int resultLen = 0;
            int rc = host->InvokeSync(moduleIdx, funcName, argsJson,
                                      &resultJson, &resultLen);

            if (rc != 0) {
                std::string errorMsg = "Unknown error";
                if (resultJson && resultLen > 0) {
                    errorMsg = extractErrorMessage(resultJson, resultLen);
                    host->FreeBuffer(resultJson);
                }
                throw JSError(rt, errorMsg);
            }

            if (!resultJson || resultLen == 0) {
                return Value::undefined();
            }

            Value result = Value::createFromJsonUtf8(rt, resultJson,
                                                     static_cast<size_t>(resultLen));
            host->FreeBuffer(resultJson);
            return result;
        });
}

static Function createAsyncHostFunction(
    Runtime& rt,
    const std::string& funcName,
    int moduleIdx,
    ExpoModuleHost* host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
{
    return Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0,
        [host, moduleIdx, funcName, callInvoker](
            Runtime& rt, const Value& thisVal,
            const Value* args, size_t count) -> Value {

            std::string argsJson = jsiArgsToJson(rt, args, count);

            auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");

            auto executor = Function::createFromHostFunction(
                rt,
                PropNameID::forUtf8(rt, "executor"),
                2,
                [host, moduleIdx, funcName, argsJson, callInvoker](
                    Runtime& rt, const Value& thisVal,
                    const Value* args, size_t count) -> Value {

                    auto resolve = std::make_shared<Function>(args[0].getObject(rt).getFunction(rt));
                    auto reject = std::make_shared<Function>(args[1].getObject(rt).getFunction(rt));

                    auto* ctx = new AsyncCallbackContext{
                        callInvoker, resolve, reject, host
                    };

                    int rc = host->InvokeAsync(
                        moduleIdx, funcName, argsJson,
                        reinterpret_cast<void*>(&AsyncCallbackTrampoline),
                        reinterpret_cast<void*>(ctx));

                    if (rc != 0) {
                        auto errMsg = String::createFromUtf8(rt,
                            "InvokeAsync failed for " + funcName + " (rc=" + std::to_string(rc) + ")");
                        reject->call(rt, JSError(rt, std::move(errMsg)).value());
                        delete ctx;
                    }

                    return Value::undefined();
                });

            return promiseCtor.callAsConstructor(rt, std::move(executor));
        });
}

void decorateModuleObject(
    Runtime& rt,
    Object& moduleObj,
    const ModuleInfo& info,
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
{
    int moduleIdx = info.index;
    ExpoModuleHost* hostPtr = &host;

    // Sync functions
    for (const auto& funcName : info.syncFunctions) {
        auto func = createSyncHostFunction(rt, funcName, moduleIdx, hostPtr);
        moduleObj.setProperty(rt, funcName.c_str(), std::move(func));
    }

    // Async functions
    for (const auto& funcName : info.asyncFunctions) {
        auto func = createAsyncHostFunction(rt, funcName, moduleIdx, hostPtr, callInvoker);
        moduleObj.setProperty(rt, funcName.c_str(), std::move(func));
    }

    // Constants — parse JSON object and set each key as a flat property
    if (!info.constantsJson.empty() && info.constantsJson != "{}") {
        auto jsonBuf = reinterpret_cast<const uint8_t*>(info.constantsJson.data());
        Value constantsVal = Value::createFromJsonUtf8(rt, jsonBuf, info.constantsJson.size());
        if (constantsVal.isObject()) {
            Object constantsObj = constantsVal.getObject(rt);
            Array propNames = constantsObj.getPropertyNames(rt);
            size_t len = propNames.size(rt);
            for (size_t i = 0; i < len; i++) {
                String key = propNames.getValueAtIndex(rt, i).getString(rt);
                Value val = constantsObj.getProperty(rt, key);
                moduleObj.setProperty(rt, key, std::move(val));
            }
        }
    }

    // Events — install startObserving/stopObserving as no-ops (MVP)
    // EventEmitter's addListener/removeListener call these when listener count crosses 0.
    if (!info.events.empty()) {
        auto startObserving = Function::createFromHostFunction(
            rt, PropNameID::forUtf8(rt, "startObserving"), 0,
            [](Runtime&, const Value&, const Value*, size_t) -> Value {
                return Value::undefined();
            });
        moduleObj.setProperty(rt, "startObserving", std::move(startObserving));

        auto stopObserving = Function::createFromHostFunction(
            rt, PropNameID::forUtf8(rt, "stopObserving"), 0,
            [](Runtime&, const Value&, const Value*, size_t) -> Value {
                return Value::undefined();
            });
        moduleObj.setProperty(rt, "stopObserving", std::move(stopObserving));
    }

    // Module name identifier
    moduleObj.setProperty(rt, "__expo_module_name__",
        String::createFromUtf8(rt, info.name));
}

} // namespace expo
```

- [ ] **Step 3: Verify the file compiles**

Add both files to the vcxproj (or verify they compile in isolation):

In `ExpoModulesWindowsCore.vcxproj`, add to the ClInclude group:
```xml
    <ClInclude Include="ExpoModuleDecorator.h" />
```

Add to the ClCompile group:
```xml
    <ClCompile Include="ExpoModuleDecorator.cpp" />
```

Build the solution. Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModuleDecorator.h
git add windows/ExpoModulesWindowsCore/ExpoModuleDecorator.cpp
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj
git commit -m "feat: add ExpoModuleDecorator — decorates NativeModule instances with C# manifest"
```

---

### Task 4: Create `ExpoEventBridge.h`

**Files:**
- Create: `windows/ExpoModulesWindowsCore/ExpoEventBridge.h`

Header-only file (like `ExpoAsyncCallback.h`). Contains the `EventBridgeContext` struct and the `EventCallbackTrampoline` that C# calls on a ThreadPool thread.

- [ ] **Step 1: Create `ExpoEventBridge.h`**

```cpp
// ExpoEventBridge.h — Event callback trampoline for C# → JS event dispatch.
// C# calls EventCallbackTrampoline on a ThreadPool thread with typed parameters;
// it copies the data and dispatches to the JS thread via CallInvoker.

#pragma once

#include <memory>
#include <string>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include "ExpoModulesHostObject.h"
#include "EventEmitter.h"
#include "LazyObject.h"

namespace expo {

struct EventBridgeContext {
    std::shared_ptr<facebook::react::CallInvoker> callInvoker;
    ExpoModulesHostObject* hostObject;
    ExpoModuleHost* host;
};

// Called from C# ThreadPool thread.
// Signature: (int moduleIndex, uint8_t* eventNameUtf8, int eventNameLen,
//             uint8_t* dataJson, int dataLen, void* userData)
inline void __stdcall EventCallbackTrampoline(
    int moduleIndex,
    uint8_t* eventNameUtf8, int eventNameLen,
    uint8_t* dataJson, int dataLen,
    void* userData)
{
    auto* ctx = static_cast<EventBridgeContext*>(userData);

    // Copy strings — C# buffers are pinned only for the duration of this call
    std::string eventName(reinterpret_cast<char*>(eventNameUtf8),
                          static_cast<size_t>(eventNameLen));
    std::string data(reinterpret_cast<char*>(dataJson),
                     static_cast<size_t>(dataLen));

    auto callInvoker = ctx->callInvoker;
    auto* hostObj = ctx->hostObject;

    callInvoker->invokeAsync([hostObj, moduleIndex, eventName = std::move(eventName),
                              data = std::move(data)](facebook::jsi::Runtime& rt) {
        using namespace facebook::jsi;

        auto* moduleObjPtr = hostObj->getModuleJsObject(moduleIndex);
        if (!moduleObjPtr) {
            // Module never accessed from JS — silently drop the event
            return;
        }

        // Unwrap LazyObject if module hasn't been fully initialized yet
        const Object& emitter = expo::LazyObject::unwrapObjectIfNecessary(rt, *moduleObjPtr);

        // Parse event data JSON to JSI values
        if (!data.empty()) {
            auto jsonBuf = reinterpret_cast<const uint8_t*>(data.data());
            Value dataVal = Value::createFromJsonUtf8(rt, jsonBuf, data.size());
            // Use the (const Object&, Value*, size_t) overload of emitEvent
            expo::EventEmitter::emitEvent(rt, emitter, eventName, &dataVal, 1);
        } else {
            expo::EventEmitter::emitEvent(rt, emitter, eventName, nullptr, 0);
        }
    });
}

} // namespace expo
```

**Note on `emitEvent` overload:** `LazyObject::unwrapObjectIfNecessary` returns `const jsi::Object&`. The `emitEvent(Runtime&, jsi::Object&, ...)` vector overload takes non-const `Object&` and would fail. We use the `(Runtime&, const Object&, string, Value*, size_t)` overload instead. Verify that this overload exists in the vendored `EventEmitter.h`. If only the vector overload exists, use a `const_cast` — the function doesn't actually modify the object.

- [ ] **Step 2: Add to vcxproj**

In `ExpoModulesWindowsCore.vcxproj`, add to ClInclude:
```xml
    <ClInclude Include="ExpoEventBridge.h" />
```

No ClCompile entry needed — this is header-only.

- [ ] **Step 3: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoEventBridge.h
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj
git commit -m "feat: add ExpoEventBridge — typed event callback trampoline"
```

---

### Task 5: Rewrite `ExpoModulesHostObject.h/cpp`

**Files:**
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h`
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp`

The HostObject now creates `LazyObject` wrappers (deferred init) that produce `NativeModule` instances decorated by `decorateModuleObject()`. It also tracks module JS objects by index for event dispatch.

- [ ] **Step 1: Rewrite `ExpoModulesHostObject.h`**

Replace the entire content of `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h`:

```cpp
// ExpoModulesHostObject.h — Top-level JSI HostObject on global.expo.modules.
// Maps module names to LazyObject-wrapped NativeModule instances.

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
                          std::shared_ptr<facebook::react::CallInvoker> callInvoker);

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

    // name -> LazyObject wrapper (cached on first access)
    std::unordered_map<std::string, std::shared_ptr<facebook::jsi::Object>> m_moduleCache;

    // moduleIndex -> decorated NativeModule JS object (populated when LazyObject initializes)
    std::unordered_map<int, std::shared_ptr<facebook::jsi::Object>> m_moduleJsObjects;
};

} // namespace expo
```

- [ ] **Step 2: Rewrite `ExpoModulesHostObject.cpp`**

Replace the entire content of `windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp`:

```cpp
// ExpoModulesHostObject.cpp — Top-level HostObject on global.expo.modules.

#include "pch.h"
#include "ExpoModulesHostObject.h"
#include "ExpoModuleDecorator.h"
#include "NativeModule.h"
#include "LazyObject.h"

namespace expo {

using namespace facebook::jsi;

ExpoModulesHostObject::ExpoModulesHostObject(
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
    : m_host(host)
    , m_callInvoker(std::move(callInvoker)) {}

Value ExpoModulesHostObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check cache
    auto it = m_moduleCache.find(nameStr);
    if (it != m_moduleCache.end()) {
        return Value(rt, *it->second);
    }

    // Look up module by name
    const ModuleInfo* info = m_host.FindModule(nameStr);
    if (!info) {
        return Value::undefined();
    }

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

std::vector<PropNameID> ExpoModulesHostObject::getPropertyNames(Runtime& rt) {
    std::vector<PropNameID> names;
    for (const auto& mod : m_host.GetModules()) {
        names.push_back(PropNameID::forUtf8(rt, mod.name));
    }
    return names;
}

Object* ExpoModulesHostObject::getModuleJsObject(int moduleIndex) {
    auto it = m_moduleJsObjects.find(moduleIndex);
    if (it != m_moduleJsObjects.end()) {
        return it->second.get();
    }
    return nullptr;
}

} // namespace expo
```

**Key changes from old version:**
- Cache stores `shared_ptr<Object>` instead of `shared_ptr<HostObject>`
- `get()` creates `LazyObject` instead of `ExpoModuleObject`
- New `m_moduleJsObjects` map tracks decorated objects by index for event dispatch
- New `getModuleJsObject()` method used by `EventCallbackTrampoline`

- [ ] **Step 3: Build and verify**

Build the solution. At this point, `ExpoModuleObject.h/cpp` are still in the project but no longer referenced by `ExpoModulesHostObject.cpp` — the old `#include "ExpoModuleObject.h"` is gone. This is fine; unreferenced files still compile.

Expected: Compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModulesHostObject.h
git add windows/ExpoModulesWindowsCore/ExpoModulesHostObject.cpp
git commit -m "feat: rewrite ExpoModulesHostObject to use LazyObject + NativeModule"
```

---

### Task 6: Rewrite initialization in `ExpoModulesWindowsCore.cpp`

**Files:**
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp`

The `Initialize()` method now installs the Expo class hierarchy on `global.expo` before creating the modules host object, then wires up the event bridge.

- [ ] **Step 1: Rewrite `Initialize()` in `ExpoModulesWindowsCore.cpp`**

Replace the entire content of `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp`:

```cpp
#include "pch.h"

#include "ExpoModulesWindowsCore.h"
#include "ExpoModuleHost.h"
#include "ExpoModulesHostObject.h"
#include "ExpoEventBridge.h"

// Expo shared C++ layer
#include "EventEmitter.h"
#include "SharedObject.h"
#include "SharedRef.h"
#include "NativeModule.h"

#include <filesystem>
#include <JSI/JsiApiContext.h>

namespace winrt::ExpoModulesWindowsCore
{

void ExpoModulesWindowsCore::Initialize(React::ReactContext const &reactContext) noexcept {
    m_context = reactContext;

    try {
        // Initialize the .NET runtime and all C# modules (on REACT_INIT thread)
        auto& host = expo::ExpoModuleHost::Instance();
        host.InitializeDefault();

        auto callInvoker = reactContext.CallInvoker();

        callInvoker->invokeAsync([&host, callInvoker](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;

            // 1. Create global.expo
            Object expo(rt);
            rt.global().setProperty(rt, "expo", expo);

            // 2. Install class hierarchy (from common/cpp/)
            expo::EventEmitter::installClass(rt);
            expo::SharedObject::installBaseClass(rt, [](expo::SharedObject::ObjectId) {
                // Releaser — called when SharedObject is GC'd.
                // Future: release C# shared objects. No-op for MVP.
            });
            expo::SharedRef::installBaseClass(rt);
            expo::NativeModule::installClass(rt);

            // 3. Install modules host object on global.expo.modules
            auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(host, callInvoker);
            auto hostObjRaw = hostObj.get();
            Object expoObj = rt.global().getPropertyAsObject(rt, "expo");
            expoObj.setProperty(rt, "modules",
                Object::createFromHostObject(rt, std::move(hostObj)));

            // 4. Wire up event bridge
            auto* eventCtx = new expo::EventBridgeContext{
                callInvoker, hostObjRaw, &host
            };
            host.SetEventCallback(
                reinterpret_cast<void*>(&expo::EventCallbackTrampoline),
                reinterpret_cast<void*>(eventCtx));
        });
    }
    catch (const std::exception& ex) {
        m_initError = ex.what();
        auto callInvoker = reactContext.CallInvoker();
        callInvoker->invokeAsync([error = m_initError](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;
            auto global = rt.global();
            Object expo(rt);
            expo.setProperty(rt, "__initError",
                String::createFromUtf8(rt, error));
            global.setProperty(rt, "expo", std::move(expo));
        });
    }
    catch (...) {
        m_initError = "unknown native exception during .NET initialization";
    }
}

double ExpoModulesWindowsCore::multiply(double a, double b) noexcept {
    return a * b;
}

bool ExpoModulesWindowsCore::install() noexcept {
    return m_initError.empty();
}

std::wstring ExpoModulesWindowsCore::FindAssemblyDir() {
    namespace fs = std::filesystem;

    static const int s_anchor = 0;
    HMODULE hModule = nullptr;
    GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&s_anchor),
        &hModule);

    wchar_t dllPath[MAX_PATH];
    GetModuleFileNameW(hModule, dllPath, MAX_PATH);
    auto dllDir = fs::path(dllPath).parent_path();

    fs::path candidates[] = {
        dllDir / "managed",
        dllDir,
        dllDir / ".." / "managed",
    };

    for (auto& dir : candidates) {
        if (fs::exists(dir / "Expo.Modules.Core.dll")) {
            return fs::weakly_canonical(dir).wstring();
        }
    }

    auto projectDir = dllDir;
    for (int i = 0; i < 5; i++) {
        auto coreDir = projectDir / "dotnet" / "Expo.Modules.Core" / "bin";
        for (const auto* config : {L"Release", L"Debug"}) {
            auto candidate = coreDir / config / "net9.0-windows10.0.19041.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::weakly_canonical(candidate).wstring();
            }
            candidate = coreDir / config / "net9.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::weakly_canonical(candidate).wstring();
            }
        }
        projectDir = projectDir.parent_path();
    }

    throw std::runtime_error("Cannot find Expo.Modules.Core.dll. "
        "Build the C# project first: dotnet build dotnet/Expo.Modules.Core");
}

std::wstring ExpoModulesWindowsCore::FindProviderAssemblyPath(const std::wstring& assemblyDir) {
    namespace fs = std::filesystem;

    static const std::wstring kCoreAssembly = L"Expo.Modules.Core.dll";

    if (!fs::exists(assemblyDir)) {
        return L"";
    }

    for (const auto& entry : fs::directory_iterator(assemblyDir)) {
        if (!entry.is_regular_file()) continue;
        auto filename = entry.path().filename().wstring();
        if (filename == kCoreAssembly) continue;

        auto ext = entry.path().extension().wstring();
        if (ext != L".dll") continue;

        if (filename.starts_with(L"System.") || filename.starts_with(L"Microsoft.")) continue;

        return entry.path().wstring();
    }

    return L"";
}

} // namespace winrt::ExpoModulesWindowsCore
```

**Key changes:**
- Added includes for `ExpoEventBridge.h`, `EventEmitter.h`, `SharedObject.h`, `SharedRef.h`, `NativeModule.h`
- `invokeAsync` lambda now: (a) creates `global.expo`, (b) installs class hierarchy via `installClass`/`installBaseClass`, (c) installs `ExpoModulesHostObject`, (d) wires event bridge
- `hostObjRaw` pointer captured before `hostObj` is moved into the JSI object — safe because the JSI object (and thus the shared_ptr) lives as long as `global.expo.modules` exists
- Error handling unchanged

- [ ] **Step 2: Build and verify**

Build the solution. Expected: compiles cleanly.

**Potential issues:**
- `expo::SharedObject::installBaseClass` may need a different releaser signature — check the vendored `SharedObject.h` for the exact typedef of the releaser callback. Adjust the lambda if needed.
- `expo::EventEmitter::installClass` / `expo::NativeModule::installClass` may have different signatures. Check the vendored headers.

- [ ] **Step 3: Commit**

```bash
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.cpp
git commit -m "feat: rewrite initialization to install Expo class hierarchy + event bridge"
```

---

### Task 7: Update C# `SendEvent()` callback signature

**Files:**
- Modify: `dotnet/Expo.Modules.Core/Module.cs:25-38`

The old callback bundles everything into one JSON blob. The new callback passes typed parameters matching the C++ `EventCallbackTrampoline` signature.

- [ ] **Step 1: Update `SendEvent()` in `Module.cs`**

Replace lines 25-38 (the `SendEvent` method) with:

```csharp
    public unsafe void SendEvent(string name, object? data = null)
    {
        if (EventCallbackPtr == IntPtr.Zero)
            return;

        var nameBytes = Encoding.UTF8.GetBytes(name);
        var dataBytes = data != null ? TypeConverter.Serialize(data) : Array.Empty<byte>();

        fixed (byte* namePtr = nameBytes)
        fixed (byte* dataPtr = dataBytes)
        {
            // Signature: (int moduleIndex, byte* eventNameUtf8, int eventNameLen,
            //             byte* dataJson, int dataLen, IntPtr userData)
            var callback = (delegate* unmanaged<int, byte*, int, byte*, int, IntPtr, void>)EventCallbackPtr;
            callback(ModuleIndex, namePtr, nameBytes.Length, dataPtr, dataBytes.Length, EventUserDataPtr);
        }
    }
```

**Key changes:**
- Old signature: `delegate* unmanaged<byte*, int, IntPtr, void>` with JSON blob `{moduleIndex, name, data}`
- New signature: `delegate* unmanaged<int, byte*, int, byte*, int, IntPtr, void>` with typed params
- No `Marshal.AllocHGlobal` needed — buffers are stack-pinned via `fixed`, C++ copies them in the trampoline
- No JSON wrapping — event name and data are passed separately

- [ ] **Step 2: Verify C# project builds**

```bash
cd D:/dev/expo-modules-windows-core
dotnet build dotnet/Expo.Modules.Core/Expo.Modules.Core.csproj
```

Expected: Builds successfully.

**Why `NativeEntryPoints.cs` needs no changes:** `Expo_EmitEvent_SetCallback` (at `dotnet/Expo.Modules.Core/Interop/NativeEntryPoints.cs:393-413`) just stores the opaque `IntPtr callbackPtr` and `IntPtr userDataPtr` and propagates them to each module's `EventCallbackPtr`/`EventUserDataPtr`. It doesn't know or care about the callback's actual signature — that's enforced by the `delegate*` cast in `Module.SendEvent()` and the C++ trampoline function. So the only C# file that changes is `Module.cs`.

- [ ] **Step 3: Commit**

```bash
git add dotnet/Expo.Modules.Core/Module.cs
git commit -m "feat: update SendEvent() to use typed callback parameters instead of JSON blob"
```

---

### Task 8: Delete old `ExpoModuleObject` and clean up vcxproj

**Files:**
- Delete: `windows/ExpoModulesWindowsCore/ExpoModuleObject.h`
- Delete: `windows/ExpoModulesWindowsCore/ExpoModuleObject.cpp`
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj`
- Modify: `windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters`

- [ ] **Step 1: Verify no remaining references to ExpoModuleObject**

```bash
grep -r "ExpoModuleObject" windows/ExpoModulesWindowsCore/ --include='*.h' --include='*.cpp' | grep -v 'ExpoModuleObject.h' | grep -v 'ExpoModuleObject.cpp'
```

Expected: No matches. The rewritten `ExpoModulesHostObject.cpp` no longer includes or references `ExpoModuleObject`.

- [ ] **Step 2: Delete the files**

```bash
rm windows/ExpoModulesWindowsCore/ExpoModuleObject.h
rm windows/ExpoModulesWindowsCore/ExpoModuleObject.cpp
```

- [ ] **Step 3: Remove from vcxproj**

In `ExpoModulesWindowsCore.vcxproj`, remove these lines:

```xml
    <ClInclude Include="ExpoModuleObject.h" />
```

```xml
    <ClCompile Include="ExpoModuleObject.cpp" />
```

- [ ] **Step 4: Final vcxproj state verification**

After all tasks, the vcxproj should have these entries (beyond the original ones):

**ClInclude** (new/changed):
```xml
    <ClInclude Include="ExpoModuleDecorator.h" />
    <ClInclude Include="ExpoEventBridge.h" />
    <ClInclude Include="common\cpp\JSIUtils.h" />
    <ClInclude Include="common\cpp\ObjectDeallocator.h" />
    <ClInclude Include="common\cpp\EventEmitter.h" />
    <ClInclude Include="common\cpp\NativeModule.h" />
    <ClInclude Include="common\cpp\SharedObject.h" />
    <ClInclude Include="common\cpp\SharedRef.h" />
    <ClInclude Include="common\cpp\LazyObject.h" />
    <ClInclude Include="common\cpp\TypedArray.h" />
    <ClInclude Include="common\cpp\BridgelessJSCallInvoker.h" />
```

**ClInclude** (removed):
```xml
    <!-- REMOVED: <ClInclude Include="ExpoModuleObject.h" /> -->
```

**ClCompile** (new):
```xml
    <ClCompile Include="ExpoModuleDecorator.cpp" />
    <ClCompile Include="common\cpp\JSIUtils.cpp"><PrecompiledHeader>NotUsing</PrecompiledHeader></ClCompile>
    <!-- ... (all 8 common/cpp/*.cpp files with NotUsing PCH) -->
```

**ClCompile** (removed):
```xml
    <!-- REMOVED: <ClCompile Include="ExpoModuleObject.cpp" /> -->
```

**AdditionalIncludeDirectories** (added):
```xml
    $(MSBuildThisFileDirectory)common\cpp;
```

- [ ] **Step 5: Build the full solution**

```bash
MSBuild.exe example/windows/ExpoModulesExample.sln /p:Platform=x64 /p:Configuration=Debug /t:Build
```

Expected: Full solution builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A windows/ExpoModulesWindowsCore/ExpoModuleObject.h
git add -A windows/ExpoModulesWindowsCore/ExpoModuleObject.cpp
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj
git add windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj.filters
git commit -m "chore: delete ExpoModuleObject, finalize vcxproj for shared C++ layer"
```

---

### Task 9: End-to-end verification

**Files:** None (testing only)

This task verifies the integration against the spec's verification criteria.

- [ ] **Step 1: Launch the example app**

Open `example/windows/ExpoModulesExample.sln` in VS 2022. Set `ExpoModulesExample.Package` as startup project. Build and run (F5) on x64/Debug.

- [ ] **Step 2: Verify class hierarchy exists**

In the React Native dev tools console (or via a test component), run:

```javascript
console.log('EventEmitter:', typeof global.expo.EventEmitter);        // "function"
console.log('SharedObject:', typeof global.expo.SharedObject);        // "function"
console.log('SharedRef:', typeof global.expo.SharedRef);              // "function"
console.log('NativeModule:', typeof global.expo.NativeModule);        // "function"
```

Expected: All four report `"function"`.

- [ ] **Step 3: Verify module access**

```javascript
const mod = global.expo.modules.ExampleModule;
console.log('ExampleModule:', mod);                                   // [object Object]
console.log('__expo_module_name__:', mod.__expo_module_name__);       // "ExampleModule"
```

Expected: Module is accessible and has the name property.

- [ ] **Step 4: Verify sync function**

```javascript
console.log('multiply:', global.expo.modules.ExampleModule.multiply(3, 4));  // 12
```

Expected: Returns `12`.

- [ ] **Step 5: Verify async function**

```javascript
const result = await global.expo.modules.ExampleModule.delayedSquare(5);
console.log('delayedSquare:', result);  // 25
```

Expected: Returns `25` after a short delay.

- [ ] **Step 6: Verify flat constants**

```javascript
console.log('platform:', global.expo.modules.ExampleModule.platform);  // "windows"
```

Expected: Constants are accessible as flat properties on the module.

- [ ] **Step 7: Verify EventEmitter / addListener**

```javascript
const sub = global.expo.modules.ExampleModule.addListener("onStatusChange", (data) => {
    console.log('Event received:', data);
});
console.log('subscription:', sub);           // { remove: [Function] }
console.log('has remove:', typeof sub.remove); // "function"
```

Expected: `addListener` returns a subscription object with a `remove()` method. This is the real EventEmitter — not our old no-op stub.

- [ ] **Step 8: Verify event emission from C#**

Trigger a C# event (e.g., via a button in the example app that calls `SendEvent`). Verify the JS listener fires.

If the example module has a periodic event or a button-triggered event:
```javascript
global.expo.modules.ExampleModule.addListener("onStatusChange", (data) => {
    console.log('C# event:', JSON.stringify(data));
});
// Trigger the event from C# side...
```

Expected: JS listener receives the event data.

- [ ] **Step 9: Verify non-existent module**

```javascript
console.log('nonexistent:', global.expo.modules.NonExistentModule);  // undefined
```

Expected: Returns `undefined` without error.

- [ ] **Step 10: Verify instanceof NativeModule**

```javascript
const mod = global.expo.modules.ExampleModule;
// Access a property to trigger LazyObject initialization
const _ = mod.multiply;
console.log('instanceof:', mod instanceof global.expo.NativeModule);  // true (if LazyObject is transparent) or false (if HostObject proxy)
```

Expected behavior depends on how JSI resolves `instanceof` through HostObject proxies:
- **If `true`**: Full upstream parity. The LazyObject unwraps and the NativeModule prototype chain is visible.
- **If `false`**: This is a **known limitation** of wrapping objects in a HostObject proxy. The unwrapped inner object IS a NativeModule instance, but JSI's `instanceof` can't see through the LazyObject wrapper. This matches expo-desktop's behavior and does NOT affect runtime functionality (addListener, events, functions all work). If this is a problem for specific use cases, the fix is to eagerly unwrap after first access — but that's a follow-up, not a blocker.

Document whichever result you observe.

- [ ] **Step 11: Commit verification notes**

If any verification steps required adjustments, commit those fixes. If everything passes:

```bash
git commit --allow-empty -m "test: verified shared C++ layer integration — all spec criteria pass"
```

---

## Troubleshooting Guide

### `cxxreact/ErrorUtils.h` not found
The vendored `EventEmitter.cpp` includes `<cxxreact/ErrorUtils.h>`. This header lives in `node_modules/react-native/ReactCommon/cxxreact/`. RNW's `Microsoft.ReactNative.CppLib.props` should add this to include paths. If not:
- Check that `$(ReactNativeWindowsDir)` resolves correctly
- Verify `$(ReactNativeDir)` points to the react-native package
- As a workaround, add `$(ReactNativeDir)\ReactCommon` to `AdditionalIncludeDirectories`

### Vendored files fail to compile with PCH errors
The vendored `common/cpp/*.cpp` files must have `<PrecompiledHeader>NotUsing</PrecompiledHeader>` in the vcxproj. They are cross-platform files that don't include our Windows PCH.

### `EventEmitter::emitEvent` overload mismatch
If the vendored `EventEmitter.h` doesn't have the `(Runtime&, const Object&, string, Value*, size_t)` overload, use the vector overload with a `const_cast`:
```cpp
Object& emitterMut = const_cast<Object&>(emitter);
std::vector<Value> args;
// ... populate args ...
expo::EventEmitter::emitEvent(rt, emitterMut, eventName, args);
```

### `SharedObject::installBaseClass` releaser signature
Check the exact typedef in `SharedObject.h`. The releaser may take `ObjectId` (an int) or something else. Adapt the lambda in `ExpoModulesWindowsCore.cpp` accordingly.

### `NativeModule::createInstance` doesn't exist
Check `NativeModule.h` for the exact factory method name. It might be `NativeModule::create(rt)` or similar. The expo-desktop MSVC patch may have changed it.

### LazyObject and `instanceof`
`instanceof` checks work via the prototype chain. A `LazyObject` HostObject wrapper may not pass `instanceof NativeModule` since it's an opaque HostObject proxy. The unwrapped inner object IS a NativeModule. If this is a problem for real usage, consider eagerly unwrapping in `get()` after first access.
