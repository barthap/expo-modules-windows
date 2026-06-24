# expo-modules-windows-core

Windows support for Expo-style C# modules in apps created with
`expo-desktop`.

This repository is a private Bun monorepo. The installable package is not at
the repo root; it lives in:

```text
packages/expo-modules-windows-core
```

The package requires `expo-desktop-modules-core` to initialize `global.expo`.
It does not create a standalone `global.expo` fallback. C# modules are exposed
through `global.expo.modules`, and unknown module names continue to resolve to
the stubs installed by expo-desktop.

## Repository Layout

```text
.
|-- packages/expo-modules-windows-core/
|   |-- src/                         JS API
|   |-- windows/ExpoModulesWindowsCore/
|   |                                RNW C++ TurboModule and JSI host
|   |-- dotnet/Expo.Modules.Core/    C# module DSL and runtime bridge API
|   |-- vendor/expo-modules-autolinking/
|   |                                Vendored Windows autolinking CLI fork
|   |-- bin/                         Package CLI entry points
|   `-- react-native.config.js       RNW dependency config
|-- scripts/e2e/
|   `-- windows-localcounter-smoke.ps1
|-- tests/                           Bun contract tests
|-- docs/                            Current design and workflow docs
`-- experiments/hostfxr-poc/         Historical HostFXR experiment
```

## Package Use

From an expo-desktop-created app:

```powershell
bun add <packed-or-published-expo-modules-windows-core>
bunx expo-modules-windows-core autolink-windows `
  --sln windows\MyApp.sln `
  --app-proj windows\MyApp\MyApp.vcxproj
```

The local development proof packs the workspace package first, then installs
the tarball into a fresh app outside this repo.

## Local Verification

```powershell
bun install
bun test
bun run typecheck
powershell -ExecutionPolicy Bypass -File .\scripts\e2e\windows-localcounter-smoke.ps1 -ValidateOnly
powershell -ExecutionPolicy Bypass -File .\scripts\e2e\windows-localcounter-smoke.ps1 -WorkRoot 'D:\dev\expo-modules-windows-core-e2e-runs' -AppName 'CodexProofMonorepoE2E' -TimeoutSeconds 300 -KeepApp
```

The full smoke script creates a fresh expo-desktop Windows app, packs
`packages/expo-modules-windows-core`, installs it, writes a local C# module
named `LocalCounter`, runs `autolink-windows`, builds and launches the app, and
proves from JS in the running app that:

```js
global.expo.modules.LocalCounter.increment() === 1
```

It also verifies that expo-desktop stubs such as `NativeModulesProxy`,
`ExpoAsset`, and `ExponentConstants` remain reachable through
`global.expo.modules`.

## Machine Requirements

- Windows 10/11.
- Bun.
- Node.js 20.
- Visual Studio/MSBuild compatible with the app's `react-native-windows`
  version. The current proof path builds RNW 0.81.x with VS 2022 and
  `PlatformToolset=v143`.
- .NET 9 SDK.

## Docs

- [Autolinking](docs/AUTOLINKING.md)
- [Build System](docs/BUILD_SYSTEM.md)
- [Code Flow](docs/CODE_FLOW.md)
- [Design](docs/DESIGN.md)
- [expo-desktop Relationship](docs/EXPO_DESKTOP.md)
