# Build System

The repo root is a private Bun monorepo. The installable package is
`packages/expo-modules-windows-core`.

## Projects

```text
packages/expo-modules-windows-core/
|-- windows/ExpoModulesWindowsCore.sln
|-- windows/ExpoModulesWindowsCore/ExpoModulesWindowsCore.vcxproj
|-- dotnet/Expo.Modules.Core/Expo.Modules.Core.csproj
`-- vendor/expo-modules-autolinking/
```

The package ships one React Native Windows native library:

- `ExpoModulesWindowsCore.vcxproj` builds `ExpoModulesWindowsCore.dll`.
- `Expo.Modules.Core.csproj` builds the managed C# module DSL/runtime support.
- `vendor/expo-modules-autolinking` supplies the `autolink-windows` command.

The checked-in package solution is only for library-level native work. Runtime
validation happens in a fresh expo-desktop app through the E2E script.

## Consuming App Build Flow

A real app has two autolinking layers:

1. React Native Windows autolinking registers
   `ExpoModulesWindowsCore::ReactPackageProvider`.
2. Expo Windows autolinking discovers C# Expo modules and generates the managed
   hub project used by the C++ host.

`react-native run-windows` does not run the Expo Windows autolinking step.
Run this explicitly when module references change:

```powershell
bunx expo-modules-windows-core autolink-windows `
  --sln windows\MyApp.sln `
  --app-proj windows\MyApp\MyApp.vcxproj
```

## Managed Deployment

The generated app-side targets copy managed output into the native output and
MSIX package layout:

```text
managed/
|-- Expo.Modules.Core.dll
|-- Expo.Modules.Core.runtimeconfig.json
|-- ExpoModulesAutolinked.dll
`-- <module assemblies and dependencies>
```

This is required because packaged Windows apps launch from the AppX layout, not
directly from the project output directory.

## Toolchain

Use the Visual Studio/MSBuild toolchain required by the app's
`react-native-windows` version. The current E2E proof creates an expo-desktop
app resolving RNW 0.81.x and builds with:

```powershell
$env:MinimumVisualStudioVersion = '17.14.0'
$env:VisualStudioVersion = '17.0'
bunx react-native run-windows --no-packager --no-launch --no-deploy --logging `
  --msbuildprops PlatformToolset=v143
```

The script registers and launches the generated loose AppX layout with
`Add-AppxPackage -Register`.
