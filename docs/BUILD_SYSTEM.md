# Build System & Project Structure

## Solution & Project Map

```
ExpoModulesWindowsCoreExample.sln  (example/windows/ — the one you open in VS)
├── ExpoModulesWindowsCoreExample.vcxproj     C++ Win32 Application (the RN app)
├── ExpoModulesWindowsCoreExample.Package.wapproj  MSIX packaging project
└── ExpoModulesWindowsCore.vcxproj            C++ DynamicLibrary (the native module)

ExpoModulesWindowsCore.sln  (windows/ — standalone, for lib-only work)
└── ExpoModulesWindowsCore.vcxproj
```

Note: C# projects (`Expo.Modules.Core.csproj`, `ExampleModule.csproj`) are **not** in the `.sln` as project references. They are built via `dotnet build` invoked from MSBuild targets. Adding SDK-style C# projects to a C++/WinRT solution causes CppWinRT cyclic dependency issues.

---

## What Each Project Produces

| Project | Type | Output |
|---------|------|--------|
| `ExpoModulesWindowsCore.vcxproj` | C++ DLL | `ExpoModulesWindowsCore.dll` + `.winmd` |
| `ExpoModulesWindowsCoreExample.vcxproj` | C++ EXE | `ExpoModulesWindowsCoreExample.exe` |
| `ExpoModulesWindowsCoreExample.Package.wapproj` | MSIX Package | `AppX/` layout directory |
| `Expo.Modules.Core.csproj` | C# Class Library | `Expo.Modules.Core.dll` + `.runtimeconfig.json` |
| `ExampleModule.csproj` | C# Class Library | `ExampleModules.dll` |

---

## What is the MSIX Package (.wapproj)?

The `.wapproj` (Windows Application Packaging Project) creates an MSIX package — a sandboxed deployment format for Windows apps. It:

1. References `ExpoModulesWindowsCoreExample.vcxproj` as its entry point
2. Collects all outputs from referenced projects (EXE, DLLs)
3. Copies files marked as `<Content>` with `DeploymentContent=true` into the AppX layout
4. Creates the final AppX directory at `Package/bin/x64/Debug/AppX/`

**"Deploy" in VS** registers the MSIX package with Windows so you can launch it. The app runs from the AppX directory, not from the vcxproj output directory. This is why files must be declared as `Content` — otherwise they won't be in the AppX layout and the app can't find them at runtime.

**AppX directory structure:**
```
AppX/ExpoModulesWindowsCoreExample/
├── ExpoModulesWindowsCoreExample.exe    (app)
├── ExpoModulesWindowsCore.dll           (native module)
├── Microsoft.ReactNative.dll            (RNW)
├── hermes.dll                           (JS engine)
├── nethost.dll                          (.NET host loader)
├── managed/
│   ├── Expo.Modules.Core.dll            (C# core)
│   ├── Expo.Modules.Core.runtimeconfig.json
│   └── ExampleModules.dll               (example module)
└── ... (CRT DLLs, WebView2, etc.)
```

---

## `yarn react-native run-windows` vs F5 in VS

`yarn react-native run-windows` (via `@react-native-community/cli`) does:

1. Runs `npx @react-native-community/cli autolink-windows` — generates `AutolinkedNativeModules.g.{h,cpp}`
2. Runs `msbuild` to build the solution (same as VS Build)
3. Deploys the MSIX package (`msbuild /t:Deploy`)
4. Launches the app from the deployed package
5. Starts Metro bundler if not already running

**F5 in VS** only does steps 2-4 but may skip the autolink step. If `AutolinkedNativeModules.g.cpp` is stale or the app crashes during RN init, it's usually because autolinking wasn't run. Run `npx react-native autolink-windows` manually before building in VS to fix this.

---

## MSBuild Targets: How C# Touches C++

### ExpoManagedDeploy.targets (imported by ExpoModulesWindowsCore.vcxproj)

```
BeforeTargets="ClCompile":  dotnet build Expo.Modules.Core.csproj
AfterTargets="Build":       Copy core DLLs → $(OutDir)\managed\
```

This ensures the C# core library is built before the C++ library compiles, and the managed DLLs are in the library's output directory.

### ExpoExampleDeploy.targets (imported by ExpoModulesWindowsCoreExample.vcxproj)

```
BeforeTargets="ClCompile":  dotnet build ExampleModule.csproj
                            (also builds Expo.Modules.Core via ProjectReference)
AfterTargets="Build":       Copy ALL managed DLLs → $(OutDir)\managed\
<Content> items:            Declare DLLs for MSIX packaging → AppX\managed\
```

This target does double duty:
1. **Copy to output** — for local dev/debugging
2. **Content declarations** — `DeploymentContent=true` tells the .wapproj to include these files in the MSIX package. Without this, the managed DLLs would be in `x64/Debug/managed/` but missing from the AppX directory where the app actually runs.

### nethost.dll

The `NetHost.props` file auto-detects the .NET SDK installation and sets `$(NetHostDir)` to the directory containing `nethost.dll`, `nethost.lib`, `hostfxr.h`, etc. This is typically:
```
C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Host.win-x64\9.x.x\runtimes\win-x64\native\
```

`nethost.dll` must also be declared as `<Content>` for MSIX packaging, otherwise the app can't load `hostfxr.dll` at runtime.

---

## DLL Copy Flow (Build → Deploy → Runtime)

```
dotnet build
  ├── Expo.Modules.Core/bin/Debug/net9.0-windows10.0.19041.0/
  │   ├── Expo.Modules.Core.dll
  │   ├── Expo.Modules.Core.runtimeconfig.json
  │   └── Expo.Modules.Core.pdb
  └── ExampleModule/bin/Debug/net9.0-windows10.0.19041.0/
      ├── ExampleModules.dll
      └── ExampleModules.pdb

MSBuild (C++ Build)
  └── example/windows/x64/Debug/
      ├── ExpoModulesWindowsCore.dll
      ├── ExpoModulesWindowsCoreExample.exe
      ├── nethost.dll
      └── managed/    ← DeployExampleModule target copies here
          ├── Expo.Modules.Core.dll
          ├── Expo.Modules.Core.runtimeconfig.json
          └── ExampleModules.dll

MSIX Deploy (wapproj)
  └── Package/bin/x64/Debug/AppX/ExpoModulesWindowsCoreExample/
      ├── ExpoModulesWindowsCoreExample.exe
      ├── ExpoModulesWindowsCore.dll
      ├── nethost.dll         ← <Content DeploymentContent=true>
      └── managed/            ← <Content Link="managed\...">
          ├── Expo.Modules.Core.dll
          ├── Expo.Modules.Core.runtimeconfig.json
          └── ExampleModules.dll
```

---

## How Native Modules Get Registered (Autolinking)

React Native Windows uses a code-generation approach for native module registration:

1. `npx react-native autolink-windows` scans `node_modules` for packages with `react-native.config.js` or `codegenConfig` in `package.json`
2. Generates `AutolinkedNativeModules.g.h` and `.g.cpp` in the example app
3. These files contain `#include` directives for each native module and a function that registers their `ReactPackageProvider`s

**AutolinkedNativeModules.g.cpp** (generated):
```cpp
#include <winrt/ExpoModulesWindowsCore.h>

void RegisterAutolinkedNativeModulePackages(
    IVector<IReactPackageProvider> const& packageProviders)
{
    packageProviders.Append(
        winrt::ExpoModulesWindowsCore::ReactPackageProvider());
}
```

**App startup chain:**
```
WinMain()
  → ReactNativeAppBuilder
  → RegisterAutolinkedNativeModulePackages()
    → Appends ExpoModulesWindowsCore::ReactPackageProvider
  → RNW creates the TurboModule when JS requires it
  → REACT_INIT fires → ExpoModulesWindowsCore::Initialize()
```

---

## Expo Module Autolinking (Future)

The forked `expo-modules-autolinking` (in `vendor/expo-modules-autolinking/`) adds Windows support:

1. Packages declare Windows support in `expo-module.json`:
   ```json
   { "platforms": ["ios", "android", "windows"] }
   ```

2. The resolver scans packages, finds C# module classes

3. Generates `ExpoModulesProvider.g.cs` listing all module types:
   ```csharp
   public static class ExpoModulesProvider {
       public static Type[] GetModuleClasses() => new[] {
           typeof(MyPackage.MyModule),
           typeof(AnotherPackage.AnotherModule),
       };
   }
   ```

4. An MSBuild target (`ExpoModulesAutolinking.targets`) runs the generator before C# compilation

Currently, `ExpoModulesProvider.g.cs` is a static file in the example module. Once autolinking is fully integrated, it will be auto-generated during build.

---

## Configuration Mapping

C# projects use `Any CPU` while C++ uses platform-specific configs. The `.sln` maps them:

| Solution Config | C++ Platform | C# Platform |
|----------------|-------------|-------------|
| Debug\|x64 | x64 | Any CPU |
| Debug\|x86 | Win32 | Any CPU |
| Debug\|ARM64 | ARM64 | Any CPU |
| Release\|x64 | x64 | Any CPU |
| Release\|x86 | Win32 | Any CPU |
| Release\|ARM64 | ARM64 | Any CPU |

This works because .NET assemblies are platform-agnostic (the .NET runtime handles architecture).
