# CLAUDE.md - Project Context

## Project: expo-modules-windows-core
An Expo Modules Core implementation for Windows, enabling C# developers to write React Native Windows native modules using the Expo Modules declarative DSL.

## Architecture (Key Concept)
Expo Modules are NOT individual TurboModules. Instead:
- A **single TurboModule** registers with RNW and installs a **JSI HostObject**
- Each C# module (Battery, Clipboard, etc.) is a **property** on that HostObject
- JS accesses: `global.expo.modules.Battery.getBatteryLevel()`
- **expo-modules-autolinking** (forked) generates `ExpoModulesProvider.g.cs` listing all module classes
- The C++ host loads .NET via HostFXR and instantiates the listed C# modules

## Repository Structure
- `src/` - TypeScript source (JS-side API, EventEmitter)
- `windows/ExpoModulesWindowsCore/` - C++ host (single TurboModule + JSI HostObject)
- `dotnet/Expo.Modules.Core/` - C# core library (Module base class, DSL) — to be created
- `example/` - React Native example app with Windows support
- `docs/DESIGN.md` - High-level design & phased implementation plan
- `docs/IMPLEMENTATION_PROMPTS.md` - Prompts for implementation agents

## Tech Stack
- **React Native Windows** 0.81+ (New Architecture, Win32 + Windows App SDK)
- **C++/WinRT** for the TurboModule host
- **C# / .NET 9** for module authoring (loaded via HostFXR)
- **HostFXR** (MVP) / **NativeAOT** (production) for C++ ↔ C# bridge
- **JSON** marshaling (MVP) → binary (later)
- **Yarn** for package management

## Build Commands
- `yarn` - Install dependencies
- `yarn example windows` or open `example/windows/*.sln` in VS 2022
- `yarn bob build` - Build JS/TS

## Key RNW Facts
- New Architecture is **C++ only** — no official C# TurboModule support
- Uses JSI for direct synchronous JS-to-native calls
- Modules register via `ReactPackageProvider` + `AddAttributedModules`
- Codegen generates `NativeXxxSpec.g.h` with compile-time method validation

## Related Repos
- `expo/expo` — reference implementation (packages/expo-modules-core/)
- `expo-modules-autolinking` — to be forked for Windows platform support
