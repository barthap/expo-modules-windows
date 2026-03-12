# Windows Autolinking Guide

This document explains how the Expo Modules autolinking system works on Windows, and how to create a module that integrates with it.

## Overview

The autolinking CLI discovers Expo modules in your project's dependencies, generates build artifacts, and patches your Visual Studio solution so that adding a new module is just `npm install` + one command.

```
npx expo-modules-autolinking autolink-windows \
  --sln windows/MyApp.sln \
  --app-proj windows/MyApp/MyApp.vcxproj
```

This single command:
1. Scans `node_modules` and `modules/` for packages with Windows Expo module configs
2. Generates a hub C# project (`ExpoModulesAutolinked/`) that references all discovered modules
3. Generates MSBuild deploy targets for build output and MSIX packaging
4. Patches the `.sln` to include all C# projects under a "Managed" solution folder
5. Patches the app `.vcxproj` with a single `<ProjectReference>` and `<Import>`

---

## Creating a Windows Expo Module

### 1. Project Structure

A minimal module package looks like this:

```
my-expo-module/
├── package.json
├── expo-module.config.json
├── MyModule.csproj
└── MyModule.cs
```

### 2. `expo-module.config.json`

This file tells the autolinking system about your module. Place it at the package root (next to `package.json`).

```json
{
  "platforms": ["windows"],
  "windows": {
    "modules": ["MyNamespace.MyModule"],
    "projectPath": "MyModule.csproj"
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platforms` | `string[]` | Yes | Must include `"windows"` |
| `windows.modules` | `(string \| object)[]` | No | Fully qualified C# class names. If omitted, the autolinking scans for `*Module.cs` files automatically. |
| `windows.projectPath` | `string` | Yes | Relative path from package root to the `.csproj` file |
| `windows.debugOnly` | `boolean` | No | If `true`, the module is only linked in Debug builds (`#if DEBUG`) |

**Module entries** can be either a string (fully qualified class name) or an object:

```json
{
  "windows": {
    "modules": [
      "MyNamespace.MyModule",
      { "name": "DisplayName", "class": "MyNamespace.AnotherModule" }
    ]
  }
}
```

### 3. `.csproj` File

Your C# project must target the same framework as the core library and reference `Expo.Modules.Core`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0-windows10.0.19041.0</TargetFramework>
    <AssemblyName>MyModule</AssemblyName>
    <RootNamespace>MyNamespace</RootNamespace>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(ExpoModulesCoreProject)"
                      Condition="'$(ExpoModulesCoreProject)' != ''" />
    <!-- Fallback for standalone development: -->
    <ProjectReference Include="path/to/Expo.Modules.Core.csproj"
                      Condition="'$(ExpoModulesCoreProject)' == ''" />
  </ItemGroup>
</Project>
```

> **Tip:** The `<AssemblyName>` value determines the output DLL filename. The autolinking reads this to generate correct deploy targets. If omitted, it defaults to the project filename.

### 4. Module Implementation

Extend `Expo.Modules.Core.Module` and override `Definition()`:

```csharp
using Expo.Modules.Core;

namespace MyNamespace;

public class MyModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        // Module name visible to JS as global.expo.modules.MyModule
        Name("MyModule"),

        // Sync function: global.expo.modules.MyModule.greet("World")
        Function<string, string>("greet", (name) => $"Hello, {name}!"),

        // Async function: await global.expo.modules.MyModule.fetchData()
        AsyncFunction<string>("fetchData", async () =>
        {
            await Task.Delay(100);
            return "result";
        }),

        // Constants: global.expo.modules.MyModule.Constants
        Constants(new { version = "1.0.0", platform = "windows" }),

        // Events: enables global.expo.modules.MyModule.addListener("onChange", ...)
        Events("onChange"),
    };
}
```

### 5. Auto-Scan (Optional)

If you omit the `modules` array in `expo-module.config.json`, the autolinking scans your package's `windows/` directory for files matching `*Module.cs` that contain `class SomeModule : Module`. This is useful for simple single-module packages:

```json
{
  "platforms": ["windows"],
  "windows": {
    "projectPath": "windows/MyModule.csproj"
  }
}
```

---

## CLI Reference

### `autolink-windows`

```
npx expo-modules-autolinking autolink-windows [searchPaths...] [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--sln <path>` | Path to the `.sln` file (relative to app root) |
| `--app-proj <path>` | Path to the app `.vcxproj` file (relative to app root) |
| `--expo-core-project <path>` | Path to `Expo.Modules.Core.csproj` (auto-detected if omitted) |
| `-e, --exclude <names...>` | Package names to exclude from autolinking |
| `-p, --project-root <path>` | App root directory (defaults to cwd) |

**Auto-detection of Expo.Modules.Core:** The command searches these locations in order:
1. `<appRoot>/dotnet/Expo.Modules.Core/Expo.Modules.Core.csproj`
2. `<appRoot>/../dotnet/Expo.Modules.Core/Expo.Modules.Core.csproj`
3. `<appRoot>/node_modules/expo-modules-windows-core/dotnet/Expo.Modules.Core/Expo.Modules.Core.csproj`

---

## What Gets Generated

Running `autolink-windows` creates/updates these files:

### `ExpoModulesAutolinked/ExpoModulesAutolinked.csproj`

A hub C# project in the app's vcxproj directory. It references `Expo.Modules.Core` and every discovered module's `.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0-windows10.0.19041.0</TargetFramework>
    <AssemblyName>ExpoModulesAutolinked</AssemblyName>
    ...
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\..\..\dotnet\Expo.Modules.Core\Expo.Modules.Core.csproj" />
    <ProjectReference Include="..\..\..\modules\MyModule\MyModule.csproj" />
  </ItemGroup>
</Project>
```

### `ExpoModulesAutolinked/ExpoModulesProvider.g.cs`

Lists all module types for the C++ host to instantiate at runtime:

```csharp
namespace Expo.Modules.Autolinking
{
    public static class ExpoModulesProvider
    {
        public static IReadOnlyList<Type> GetModuleClasses()
        {
            return new Type[]
            {
                typeof(MyNamespace.MyModule),
#if DEBUG
                typeof(DebugOnly.DebugModule),
#endif
            };
        }
    }
}
```

### `ExpoModulesAutolinked.g.targets`

MSBuild targets imported by the app vcxproj. Handles:
- **Post-build copy:** Copies all managed DLLs/PDBs to `$(OutDir)\managed\`
- **MSIX content:** Declares `<Content>` items with `DeploymentContent=true` so assemblies appear in the AppX package
- **PDB inclusion:** Debug PDBs are included only when `Configuration == Debug`
- **nethost.dll:** Ensures the .NET host runtime DLL is packaged

All paths use `$(MSBuildThisFileDirectory)` relative references for portability.

### Solution & Project Patches

**`.sln` changes:**
- Creates a "Managed" solution folder (if not present)
- Adds `Expo.Modules.Core`, `ExpoModulesAutolinked`, and each module as C# projects
- Generates `ProjectConfigurationPlatforms` entries for all solution configs (Debug/Release x x64/x86/ARM64)
- Nests all managed projects under the "Managed" folder
- Removes stale project entries from previous runs

**`.vcxproj` changes:**
- Adds a single `<ProjectReference>` to `ExpoModulesAutolinked.csproj` (with `ReferenceOutputAssembly=false`)
- Adds `<Import Project="ExpoModulesAutolinked.g.targets" />`
- Removes old manual references (e.g., direct module csproj refs, `ExpoExampleDeploy.targets`)
- Ensures `<CppWinRTGenerateWindowsMetadata>false</CppWinRTGenerateWindowsMetadata>` is set

---

## Idempotency

The command is fully idempotent:
- Generated files are only written if their content has changed
- Solution/vcxproj patches check for existing entries before adding
- Stale entries (modules removed since last run) are cleaned up automatically
- GUIDs are deterministic (SHA-1 hash of project name), so re-runs produce identical results

---

## Local Development Modules

Modules in your app's `modules/` directory (the default `nativeModulesDir`) are discovered automatically. Each subdirectory needs:

1. A `package.json` (even a minimal one with just `name` and `version`)
2. An `expo-module.config.json` with `"platforms": ["windows"]`
3. A `.csproj` referenced by `windows.projectPath`

Example for a local module:

```
my-app/
├── modules/
│   └── my-local-module/
│       ├── package.json           # { "name": "my-local-module", "version": "0.0.0" }
│       ├── expo-module.config.json
│       ├── MyLocalModule.csproj
│       └── MyLocalModule.cs
├── windows/
│   └── MyApp.sln
└── package.json
```

---

## Integration with the Build

The autolinking output integrates into the MSBuild pipeline as follows:

```
MSBuild builds MyApp.vcxproj
  → ProjectReference triggers build of ExpoModulesAutolinked.csproj
    → which transitively builds Expo.Modules.Core.csproj + all module .csproj files
  → ExpoModulesAutolinked.g.targets runs AfterTargets="Build"
    → copies all managed DLLs to $(OutDir)\managed\
  → MSIX packaging (wapproj) picks up Content items
    → managed DLLs + nethost.dll appear in the AppX package
```

At runtime, the C++ host (`ExpoModuleHost`) uses HostFXR to load the .NET runtime and calls `Expo_DiscoverModules` which reads `ExpoModulesProvider.GetModuleClasses()` to find all module types.

---

## Troubleshooting

**Module not discovered:**
- Verify `expo-module.config.json` exists at the package root and contains `"platforms": ["windows"]`
- Ensure the package has a `package.json` with a `name` field
- Check that `windows.projectPath` points to a valid `.csproj` file

**Build errors after autolinking:**
- Run `autolink-windows` again — it will clean up stale references
- Verify all module `.csproj` files target `net9.0-windows10.0.19041.0`
- Ensure modules reference `Expo.Modules.Core` as a `<ProjectReference>`

**MSIX deployment failures:**
- Check that the `.g.targets` file is imported in the `.vcxproj`
- Verify the wapproj startup project is selected (not the vcxproj directly)
- Look for `DeploymentContent=true` on all managed Content items
