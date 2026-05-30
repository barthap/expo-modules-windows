# Relationship with expo-desktop

This document describes how expo-modules-windows-core relates to the [expo-desktop](https://github.com/shirakaba/expo-desktop) project and Expo's upstream shared C++ layer.

## Background

Expo's `expo-modules-core` package (in the [expo/expo](https://github.com/expo/expo) monorepo) includes a `common/cpp/` directory containing platform-independent C++ code that implements the JS runtime layer: class hierarchy installation, event subscriptions, lazy module loading, and shared object lifecycle. On iOS and Android, the platform-specific code (Swift/Kotlin) creates instances of these C++ classes and decorates them with module functions and properties.

The [expo-desktop](https://github.com/shirakaba/expo-desktop) project by [@nicolo-ribaudo](https://github.com/nicolo-ribaudo) (originally by [@nicolo-ribaudo](https://github.com/nicolo-ribaudo) and maintained by [@nicolo-ribaudo](https://github.com/nicolo-ribaudo) under the shirakaba org) ports Expo Modules to desktop platforms (macOS, Linux). As part of that work, it patches the `common/cpp/` files for MSVC compatibility — replacing `#import` with `#include`, adding missing `<functional>` includes, and adjusting include paths for non-Apple platforms.

## What We Vendor

We vendor the `common/cpp/` directory from expo-desktop into `windows/ExpoModulesWindowsCore/common/cpp/`. These are the MSVC-patched versions of Expo's shared C++ layer, pinned to **Expo SDK 54**.

**Upstream commit:** [`bcdf485`](https://github.com/shirakaba/expo-desktop/commit/bcdf48576fe52db755b5277827821df53505dc88)
**Source path:** `packages/expo-desktop-modules-core/common/cpp/`

### Vendored Files (17 files)

| File | Purpose |
|------|---------|
| `EventEmitter.h/cpp` | NativeState-backed event subscriptions, `addListener`/`removeListeners`/`emit`, error isolation via `cxxreact/ErrorUtils.h` |
| `NativeModule.h/cpp` | JS class inheriting EventEmitter, installed on `global.expo.NativeModule` |
| `SharedObject.h/cpp` | Reference-counted native handles with GC-triggered release callbacks |
| `SharedRef.h/cpp` | Extends SharedObject for typed native references |
| `LazyObject.h/cpp` | JSI HostObject that defers initialization until first property access |
| `JSIUtils.h/cpp` | Class creation helpers, prototype chains, `defineProperty` |
| `ObjectDeallocator.h/cpp` | NativeState-based destructor callbacks for GC cleanup |
| `TypedArray.h/cpp` | JS TypedArray (`Uint8Array`, etc.) wrappers |
| `BridgelessJSCallInvoker.h` | Async JS call scheduling (header-only) |

### Files NOT Vendored

| File | Reason |
|------|--------|
| `TestingSyncJSCallInvoker.h` | Test-only, not needed for production |

## MSVC Patches (already applied by expo-desktop)

The vendored files include these MSVC compatibility patches:

1. **`#import` → `#include`** — MSVC's `#import` is a COM directive, not a C++ include
2. **`#include <functional>` added** — MSVC requires explicit include for `std::function`
3. **Non-Apple include paths** — use local `#include "..."` instead of framework `#include <ExpoModulesCore/...>`

We take these files as-is with no further modifications.

## How We Use It

The shared C++ layer provides the JS-visible class hierarchy. Our platform-specific code (the "Windows platform layer") uses it as follows:

1. **Initialization** (`ExpoModulesWindowsCore.cpp`): Installs the class hierarchy on `global.expo` — `EventEmitter`, `SharedObject`, `SharedRef`, `NativeModule`.

2. **Module creation** (`ExpoModulesHostObject.cpp`): Creates `LazyObject` wrappers that, on first property access, call `NativeModule::createInstance()` to get a proper JS instance.

3. **Module decoration** (`ExpoModuleDecorator.cpp`): Sets functions, constants, and events as plain JS properties on the `NativeModule` instance. This is our equivalent of what Swift does on iOS and Kotlin does on Android.

4. **Event dispatch** (`ExpoEventBridge.h`): Uses `EventEmitter::emitEvent()` to fire events through the proper subscription system, giving JS callers real `Subscription` objects with `remove()`.

### What expo-desktop provides vs what we built

| Component | Source |
|-----------|--------|
| JS class hierarchy (EventEmitter, NativeModule, etc.) | expo-desktop (vendored `common/cpp/`) |
| Module loading and decoration | Our code (`ExpoModulesHostObject`, `ExpoModuleDecorator`) |
| .NET runtime bridge (HostFXR) | Our code (`ExpoModuleHost`) |
| C# module DSL | Our code (`dotnet/Expo.Modules.Core/`) |
| Event bridge (C# ThreadPool → JS thread) | Our code (`ExpoEventBridge`) |
| JSON marshaling (JSI ↔ C#) | Our code (`ExpoMarshal`, `ExpoAsyncCallback`) |
| Windows Expo autolinking | Our code (`vendor/expo-modules-autolinking/`) |

## Build Integration

The vendored files are compiled as part of the `ExpoModulesWindowsCore.vcxproj` with `<PrecompiledHeader>NotUsing</PrecompiledHeader>` since they are cross-platform code that doesn't use Windows PCH.

One additional include path is needed: `$(ReactNativeWindowsDir)..\react-native\ReactCommon` — this resolves the `<cxxreact/ErrorUtils.h>` include in `EventEmitter.cpp`. RNW's internal `React.Cpp.props` adds this path, but external CppLib consumers don't inherit it.

## Updating the Vendored Files

To update to a newer Expo SDK version:

1. Check [expo-desktop releases](https://github.com/shirakaba/expo-desktop/releases) for the target SDK version
2. Copy the updated `common/cpp/` files from `packages/expo-desktop-modules-core/common/cpp/`
3. Verify MSVC patches are still present (they should be, as expo-desktop targets MSVC)
4. Check for new files that may need to be added to the vcxproj
5. Check for API changes in `EventEmitter::emitEvent()`, `NativeModule::createInstance()`, `SharedObject::installBaseClass()`, etc. that affect our platform layer code
6. Build and test

### Version Pinning

We are currently pinned to **Expo SDK 54**. When updating, check for breaking changes in:

- `EventEmitter::emitEvent()` signature (we use the `(Runtime&, Object&, string, vector<Value>&)` overload)
- `NativeModule::installClass()` / `createInstance()` API
- `SharedObject::installBaseClass()` releaser callback signature
- `LazyObject` initializer callback type
- Any new dependencies or include requirements

## Relationship Summary

```
expo/expo (upstream)
  └── packages/expo-modules-core/common/cpp/    # Platform-independent C++ layer
        │
        ├── iOS: used directly by Swift platform layer
        ├── Android: used directly by Kotlin platform layer
        │
        └── shirakaba/expo-desktop                # Desktop port
              └── packages/expo-desktop-modules-core/common/cpp/
                    │  (MSVC-patched version)
                    │
                    └── expo-modules-windows-core (this repo)
                          └── windows/ExpoModulesWindowsCore/common/cpp/
                                (vendored copy, no further modifications)
```

We do not depend on expo-desktop at runtime or build time — we vendor a snapshot of its `common/cpp/` files. expo-desktop is the upstream source for MSVC-compatible patches; upstream `expo/expo` is the ultimate source of truth for the C++ layer's behavior.
