# Windows Autolinking

`expo-modules-windows-core autolink-windows` discovers Windows Expo modules,
generates a managed hub project, and patches the consuming React Native Windows
solution.

Run it from the app root after installing this package and after adding,
removing, or changing local C# modules:

```powershell
bunx expo-modules-windows-core autolink-windows `
  --sln windows\MyApp.sln `
  --app-proj windows\MyApp\MyApp.vcxproj
```

## Local Module Shape

App-local modules live under the app's `modules/` directory. A minimal module
looks like:

```text
modules/LocalCounter/
|-- package.json
|-- expo-module.config.json
|-- LocalCounterModule.csproj
`-- LocalCounterModule.cs
```

`expo-module.config.json`:

```json
{
  "platforms": ["windows"],
  "windows": {
    "modules": ["LocalCounterModule.LocalCounterModule"],
    "projectPath": "LocalCounterModule.csproj"
  }
}
```

`LocalCounterModule.csproj` should reference the core project through the
property supplied by autolinking:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0-windows10.0.19041.0</TargetFramework>
    <AssemblyName>LocalCounterModule</AssemblyName>
    <RootNamespace>LocalCounterModule</RootNamespace>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="$(ExpoModulesCoreProject)" />
    <PackageReference Include="Microsoft.WindowsAppSDK" Version="1.7.250401001" ExcludeAssets="build;buildTransitive" />
  </ItemGroup>
</Project>
```

Do not add a hard-coded fallback reference to `Expo.Modules.Core`. The generated
hub project supplies `ExpoModulesCoreProject` so modules work both as app-local
code and as packages.

Module implementation:

```csharp
using Expo.Modules.Core;

namespace LocalCounterModule;

public sealed class LocalCounterModule : Module
{
    private int _count;

    public override ModuleDefinition Definition() => new()
    {
        Name("LocalCounter"),
        Function<int>("increment", () => ++_count),
        Function<int>("getCount", () => _count),
        Constants(new { initialValue = 0, platform = "windows" })
    };
}
```

JS sees the module at:

```js
global.expo.modules.LocalCounter.increment()
```

## Generated Files

The command creates or updates:

- `ExpoModulesAutolinked/ExpoModulesAutolinked.csproj`
- `ExpoModulesAutolinked/ExpoModulesProvider.g.cs`
- `ExpoModulesAutolinked.g.targets`
- package layout targets for `.wapproj` deployment
- `.sln` entries for managed projects
- a single managed `ProjectReference` and target import in the app `.vcxproj`

The generated targets copy managed DLLs, dependency DLLs, PDBs, `.deps.json`,
`.runtimeconfig.json`, and `nethost.dll` into both the native output directory
and MSIX package layout.

## Options

```text
bunx expo-modules-windows-core autolink-windows [searchPaths...] [options]
```

- `--sln <path>`: solution path relative to app root.
- `--app-proj <path>`: app `.vcxproj` path relative to app root.
- `--expo-core-project <path>`: optional explicit path to
  `Expo.Modules.Core.csproj`.
- `--exclude <names...>`: package names to exclude.
- `--project-root <path>`: app root; defaults to current working directory.

When `--expo-core-project` is omitted, autolinking searches the app and package
locations, including:

```text
node_modules\expo-modules-windows-core\dotnet\Expo.Modules.Core\Expo.Modules.Core.csproj
```

## Verification

The repository proof is:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\e2e\windows-localcounter-smoke.ps1 -WorkRoot 'D:\dev\expo-modules-windows-core-e2e-runs' -AppName 'CodexProofMonorepoE2E' -TimeoutSeconds 300 -KeepApp
```
