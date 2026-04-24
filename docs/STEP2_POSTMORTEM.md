# Step 2 Post-Mortem: C++ Host Object Issues

## Issue 1: `reinterpret_cast` — Member Function Pointer to LPCWSTR

**Symptom:** Build error: `'reinterpret_cast': cannot convert from 'void (__cdecl ...) to LPCWSTR'`

**Root cause:** `GetModuleHandleExW` with `GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS` requires a pointer that lives in the target module's address space. The original code tried to cast a member function pointer (`&ExpoModulesWindowsCore::Initialize`), which is not a regular pointer on MSVC (member function pointers have a different representation).

**Fix:** Use a static variable's address instead:
```cpp
static const int s_anchor = 0;
GetModuleHandleExW(
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCWSTR>(&s_anchor),
    &hModule);
```

## Issue 2: NetHost.props — Multiple .NET SDK Versions

**Symptom:** MSBuild error MSB4012 when multiple .NET SDK versions are installed. `$(NetHostDir)` resolves to a semicolon-separated list instead of a single path.

**Root cause:** The original props file used MSBuild item transforms (`@(_NetHostCandidate->'%(RootDir)%(Directory)')`) inside a `<PropertyGroup>`. When multiple versions match the glob, the transform produces a semicolon-separated list, which is invalid for a single directory property.

**Approaches that failed:**
- **Item metadata batching in PropertyGroup** — MSB4190: metadata expressions not allowed in `Condition` inside `<PropertyGroup>`.
- **Target-based resolution** — `NetHostDir` was empty at property evaluation time but needed early for `AdditionalIncludeDirectories`.

**Fix:** Pure property-function approach using `System.IO.Directory::GetDirectories`:
```xml
<_NetHostVersionDirs>$([System.String]::Join(';',
    $([System.IO.Directory]::GetDirectories('$(_HostPackBase)'))))</_NetHostVersionDirs>
<_NetHostLatestVersionDir Condition="$(_NetHostVersionDirs.Contains(';'))">
    $(_NetHostVersionDirs.Substring(
        $([MSBuild]::Add($(_NetHostVersionDirs.LastIndexOf(';')), 1))))
</_NetHostLatestVersionDir>
```
This picks the last (alphabetically highest = latest version) directory using string manipulation, all within static property evaluation.

## Issue 3: CppWinRT Cyclic Dependency (Intermittent)

**Symptom:** `MSB4006: Circular dependency on the target dependency graph involving target "CppWinRTComputeGetResolvedWinMD"`.

**Root cause:** Stale build artifacts from previous builds confuse CppWinRT's target resolution. The cycle is **not caused by our code changes** — it's a transient MSBuild issue.

**Fix:** Full clean rebuild. Delete `bin/`, `obj/`, and platform-specific output directories (`x64/`, etc.), then rebuild. May need to clean 2-3 times if the first clean itself fails.

## Issue 4: `CLASS_NOT_REGISTERED` — Missing MSIX Content Declarations

**Symptom:** `CLASS_NOT_REGISTERED` crash at `ReactNativeAppBuilder().Build()` → `DispatcherQueueController::CreateOnCurrentThread()`. The crash happens before any of our module code runs. Affects both `yarn react-native run-windows` and VS F5.

**Root cause:** MSIX-packaged apps run from the AppX directory, not from the vcxproj output directory (`$(OutDir)`). Files must be declared as `<Content>` with `<DeploymentContent>true</DeploymentContent>` to be included in the AppX layout. Without this, files copied by post-build targets (e.g. `CopyNethost`, managed DLL copy) end up in `$(OutDir)` but are **not** in the deployed package.

The specific failure chain:
1. `ExpoModulesWindowsCore.dll` links `nethost.lib` → `nethost.dll` is in the DLL's import table
2. `nethost.dll` was only copied to `$(OutDir)` by a post-build target, not declared as `Content`
3. MSIX package deploys without `nethost.dll`
4. OS cannot load `ExpoModulesWindowsCore.dll` (missing dependency)
5. Our DLL is registered as an in-process WinRT server in the AppxManifest → broken registration
6. **ALL** WinRT class activations fail, including WinAppSDK's `DispatcherQueueController`

**Why this was confusing to diagnose:**
- The crash appeared to happen before any of our code runs (at `ReactNativeAppBuilder().Build()`)
- The error (`CLASS_NOT_REGISTERED` on `DispatcherQueueController`) pointed to WinAppSDK, not our code
- The actual cause was our DLL's broken registration poisoning the entire package
- Delay-loading `nethost.dll` didn't help because the DLL is still in the import table and the MSIX packager still can't find it

**Why dynamic hostfxr loading appeared to fix it:** Removing `nethost.lib` from the linker removed `nethost.dll` from the import table entirely, so `ExpoModulesWindowsCore.dll` could load without it. This masked the real issue (missing Content declarations) rather than fixing it.

**Actual fix:** Declare all non-C++ files as `Content` with `DeploymentContent=true`:
```xml
<!-- In deploy targets (e.g. ExpoExampleDeploy.targets) -->
<ItemGroup>
  <Content Include="path\to\nethost.dll">
    <Link>nethost.dll</Link>
    <DeploymentContent>true</DeploymentContent>
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </Content>
  <Content Include="path\to\managed\Expo.Modules.Core.dll">
    <Link>managed\Expo.Modules.Core.dll</Link>
    <DeploymentContent>true</DeploymentContent>
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </Content>
</ItemGroup>
```

**Key rule for MSIX projects:** Any file that needs to be available at runtime must be declared as `Content` with `DeploymentContent=true`. Post-build copy targets (`<Copy>`) only place files in `$(OutDir)`, which is **not** where the app runs from when deployed as MSIX.

## Issue 5: VS F5 Deployment — Wrong Startup Project

**Symptom:** `CLASS_NOT_REGISTERED` crash with VS F5 even after Content declarations are correct, while `yarn react-native run-windows` works.

**Root cause:** The startup project was set to `ExpoModulesWindowsCoreExample` (the vcxproj) instead of `ExpoModulesWindowsCoreExample.Package` (the wapproj). When the vcxproj is the startup project:
1. The wapproj is **not** a dependency of the vcxproj (it's the reverse), so VS never builds or deploys the MSIX package
2. VS launches the .exe directly from `x64/Debug/` without MSIX registration
3. The `AppxManifest.xml` activatable class entries (`ExpoModulesWindowsCore.ReactPackageProvider`, etc.) don't apply
4. All WinRT class activations fail → `CLASS_NOT_REGISTERED`

**Why `yarn react-native run-windows` works:** The CLI always builds the entire solution, then explicitly deploys using `DeployAppRecipe.exe` with the wapproj's `.build.appxrecipe`, and launches via `ApplicationActivationManager.ActivateApplication()`.

**Fix:** In VS, right-click `ExpoModulesWindowsCoreExample.Package` → **Set as Startup Project**, then F5.

## Key Takeaways

1. **MSIX Content declarations are mandatory.** Any file the app needs at runtime (DLLs, config files, etc.) must be declared as `<Content>` with `<DeploymentContent>true</DeploymentContent>`. Post-build `<Copy>` targets are not sufficient — they only copy to `$(OutDir)`, not the AppX layout.
2. **A broken in-process WinRT server DLL poisons the entire package.** If your DLL is registered in the AppxManifest and can't be loaded (missing dependencies), ALL WinRT activations fail — even for unrelated system classes.
3. **CppWinRT cycle errors are transient** — clean rebuild (possibly multiple times) resolves them.
4. **MSBuild property evaluation** happens before targets run. Properties needed for `AdditionalIncludeDirectories` must use static property functions, not target-based resolution.
5. **Set the `.Package` (wapproj) as the VS startup project**, not the vcxproj. The wapproj handles MSIX registration; without it, WinRT activations fail.
