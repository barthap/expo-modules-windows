# Design

`expo-modules-windows-core` adds C# Expo modules to expo-desktop Windows apps.

## Runtime Contract

- expo-desktop owns `global.expo`.
- `expo-desktop-modules-core` is a required peer dependency.
- This package composes with the existing `global.expo.modules` object instead
  of replacing expo-desktop behavior wholesale.
- Standalone `global.expo` initialization is intentionally unsupported.

## Package Responsibilities

- Register one React Native Windows TurboModule.
- Load .NET with HostFXR.
- Discover managed module classes through the generated
  `ExpoModulesAutolinked.dll`.
- Expose C# module functions, constants, and events as Expo `NativeModule`
  instances.
- Preserve expo-desktop module stubs through fallback lookup.
- Provide Windows autolinking for app-local and dependency C# modules.

## Monorepo Boundaries

The repo root owns workspace scripts, tests, docs, and the E2E proof. The
publishable package owns everything needed by a consuming app:

```text
packages/expo-modules-windows-core/
|-- src/
|-- windows/
|-- dotnet/Expo.Modules.Core/
|-- vendor/expo-modules-autolinking/
|-- bin/
`-- react-native.config.js
```

The package exports source files directly for the current source-tree tarball
workflow. No generated `lib/` output is required for the E2E proof.

## Acceptance Proof

The proof is intentionally app-level, not just autolinking-level:

1. Create a fresh expo-desktop Windows app outside the repo.
2. Pack `packages/expo-modules-windows-core`.
3. Install the packed tarball into the app.
4. Write an app-local C# module named `LocalCounter`.
5. Run `bunx expo-modules-windows-core autolink-windows`.
6. Build, register, and launch the Windows app.
7. Prove from JS in the running app that
   `global.expo.modules.LocalCounter.increment()` works.
8. Prove expo-desktop stubs remain reachable through `global.expo.modules`.
