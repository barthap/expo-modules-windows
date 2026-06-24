# expo-modules-windows-core

Expo Modules Core implementation for Windows, enabling C# developers to write React Native Windows native modules using the Expo Modules declarative DSL — without touching C++ boilerplate.

> **Status:** HostFXR-based MVP for apps created with
> [expo-desktop](https://github.com/shirakaba/expo-desktop).
> Sync/async functions, constants, events (with real `EventEmitter` subscriptions),
> build integration, and Windows Expo autolinking are working.
> `expo-desktop-modules-core` owns the Expo JS runtime on Windows; this package
> adds the C# module host and managed autolinking on top of it.
> View components and NativeAOT mode are the next major milestones.

## How It Works

On iOS and Android, Expo Modules lets you write native modules in Swift/Kotlin using a declarative DSL. This project brings the same pattern to Windows with C#:

```csharp
public class BatteryModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("Battery"),

        Function("getBatteryLevel", () =>
        {
            var report = Battery.AggregateBattery.GetReport();
            return report.RemainingCapacityInMilliwattHours /
                   (double)report.FullChargeCapacityInMilliwattHours;
        }),

        AsyncFunction("requestPowerMode", async (string mode) =>
        {
            await PowerManager.SetModeAsync(mode);
            return true;
        }),

        Events("onBatteryChanged"),
    };
}
```

Modules are accessible from JavaScript as `global.expo.modules.Battery.getBatteryLevel()`.

Under the hood, `expo-desktop-modules-core` installs Expo's shared JS runtime classes (`EventEmitter`, `NativeModule`, `SharedObject`, `SharedRef`) on `global.expo`. This package registers a single C++ TurboModule with React Native Windows, loads the .NET runtime via HostFXR, and replaces `global.expo.modules` with a host object that serves C# modules while delegating unknown names back to expo-desktop's original modules object. Each C# module is wrapped as a `NativeModule` instance with lazy initialization via `LazyObject`. See [docs/DESIGN.md](docs/DESIGN.md), [docs/CODE_FLOW.md](docs/CODE_FLOW.md), and [docs/EXPO_DESKTOP.md](docs/EXPO_DESKTOP.md).

## Prerequisites

- **Windows 10/11** with the Visual Studio toolchain required by your
  `react-native-windows` version. Current expo-desktop fresh apps resolved to
  RNW 0.81.29 during verification. Windows PC built the proof app with Visual
  Studio 2022 17.14 by setting `MinimumVisualStudioVersion=17.14.0`,
  `VisualStudioVersion=17.0`, and passing `PlatformToolset=v143`.
- An app created with `expo-desktop create-app`, or an RNW app that installs
  `expo-desktop-modules-core` and `expo-desktop-stubs`
- **React Native Windows** 0.81+ (New Architecture)
- **.NET 9 SDK** (`winget install Microsoft.DotNet.SDK.9`)
- **Node.js** 18+ and **Yarn**

## Installation

```bash
bunx expo-desktop@latest create-app
bun add expo-modules-windows-core
```

Then run Expo Windows autolinking after adding or removing C# modules:

```bash
bunx expo-modules-windows-core autolink-windows \
  --sln windows/MyApp.sln \
  --app-proj windows/MyApp/MyApp.vcxproj
```

This generates the build integration files and patches your solution. See
[Autolinking](#autolinking) below.

## Module API

Modules extend `Expo.Modules.Core.Module` and override `Definition()`. The DSL supports:

### Functions

Synchronous functions callable from JS:

```csharp
// JS: MyModule.multiply(3, 4) -> 12
Function<double, double, double>("multiply", (a, b) => a * b),

// JS: MyModule.greet("World") -> "Hello, World!"
Function<string, string>("greet", (name) => $"Hello, {name}!"),
```

### Async Functions

Functions that return a `Task<T>`, awaitable from JS:

```csharp
// JS: await MyModule.fetchData()
AsyncFunction<string>("fetchData", async () =>
{
    var response = await httpClient.GetStringAsync(url);
    return response;
}),
```

### Constants

Static values exposed as flat properties on the module object (matching upstream Expo on iOS/Android):

```csharp
// JS: MyModule.platform -> "windows"
//     MyModule.version  -> "1.0.0"
Constants(new
{
    platform = "windows",
    version = "1.0.0",
}),
```

### Events

Named events that can be sent from C# to JS:

```csharp
Events("onChange", "onError"),
```

Send events from module code:

```csharp
SendEvent("onChange", new { value = 42 });
```

### Lifecycle

```csharp
OnCreate(() => { /* module instantiated */ }),
OnDestroy(() => { /* cleanup */ }),
OnStartObserving(() => { /* JS started listening to events */ }),
OnStopObserving(() => { /* JS stopped listening */ }),
```

For the full DSL reference and type system, see [docs/RESEARCH_DSL.md](docs/RESEARCH_DSL.md).

## Autolinking

The autolinking CLI automates all build integration. After installing a module
package, run:

```bash
bunx expo-modules-windows-core autolink-windows \
  --sln windows/MyApp.sln \
  --app-proj windows/MyApp/MyApp.vcxproj
```

This will:
- Discover all packages with `expo-module.config.json` containing `"platforms": ["windows"]`
- Generate a hub C# project with `ExpoModulesProvider.g.cs` listing all module types
- Generate MSBuild deploy targets for build output, managed dependency DLLs,
  and MSIX packaging
- Patch the `.sln` (add C# projects) and `.vcxproj` (add references)

The command is idempotent — safe to re-run after adding or removing modules.
At the moment it is still a separate step from `react-native run-windows`, so a
fresh clone should run it before the first Windows build.

### Module Package Config

Each module needs an `expo-module.config.json` at the package root:

```json
{
  "platforms": ["windows"],
  "windows": {
    "modules": ["MyNamespace.MyModule"],
    "projectPath": "MyModule.csproj"
  }
}
```

For the complete autolinking guide — including local module development, CLI options, generated file details, and troubleshooting — see [docs/AUTOLINKING.md](docs/AUTOLINKING.md).

## Running the Example App

```bash
# Install dependencies
yarn install

# Run autolinking
cd example
bunx expo-modules-windows-core autolink-windows \
  --sln windows/ExpoModulesWindowsCoreExample.sln \
  --app-proj windows/ExpoModulesWindowsCoreExample/ExpoModulesWindowsCoreExample.vcxproj

# Open in Visual Studio
# Set ExpoModulesWindowsCoreExample.Package as startup project
# Build and run (F5)
```

Or open `example/windows/ExpoModulesWindowsCoreExample.sln` directly in VS 2022.

## Repository Structure

```
expo-modules-windows-core/
├── src/                             # TypeScript (JS-side API, EventEmitter)
├── windows/ExpoModulesWindowsCore/  # C++ host (TurboModule + JSI)
│   ├── common/cpp/                  # Vendored Expo shared C++ layer (from expo-desktop)
│   ├── ExpoModuleHost.h/cpp         # HostFXR .NET runtime loader
│   ├── ExpoModulesHostObject.h/cpp  # JSI HostObject on global.expo.modules
│   ├── ExpoModuleDecorator.h/cpp    # Decorates NativeModule with C# manifest
│   ├── ExpoEventBridge.h            # C# → JS event dispatch trampoline
│   └── ExpoMarshal.h/cpp            # JSON ↔ JSI conversion
├── dotnet/Expo.Modules.Core/       # C# core library (Module base class, DSL)
├── vendor/expo-modules-autolinking/ # Autolinking CLI fork
├── example/                         # React Native example app
│   ├── modules/ExampleModule/       # Example C# module
│   └── windows/                     # Windows project files
└── docs/                            # Design docs and guides
```

## Documentation

| Document | Description |
|----------|-------------|
| [DESIGN.md](docs/DESIGN.md) | Architecture overview and design decisions |
| [IMPLEMENTATION_PROMPTS.md](docs/IMPLEMENTATION_PROMPTS.md) | Current implementation status and next milestones |
| [AUTOLINKING.md](docs/AUTOLINKING.md) | Autolinking guide for module authors |
| [BUILD_SYSTEM.md](docs/BUILD_SYSTEM.md) | Build system, project structure, MSBuild targets |
| [CODE_FLOW.md](docs/CODE_FLOW.md) | End-to-end call flow from JS to C# and back |
| [EXPO_DESKTOP.md](docs/EXPO_DESKTOP.md) | Relationship with expo-desktop and the shared C++ layer |
| [RESEARCH_DSL.md](docs/RESEARCH_DSL.md) | Full DSL reference (functions, types, lifecycle) |

## License

MIT
