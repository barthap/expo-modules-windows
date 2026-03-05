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

## Issue 4: `nethost.dll` — Static Link Breaks MSIX Deployment

**Symptom:** `CLASS_NOT_REGISTERED` crash at `ReactNativeAppBuilder().Build()` → `DispatcherQueueController::CreateOnCurrentThread()`. The crash happens before any of our module code runs.

**Root cause:** Linking `nethost.lib` (import library) adds `nethost.dll` to the DLL's import table. `nethost.dll` is part of the .NET SDK and is not redistributed in the MSIX package. When the MSIX packager deploys the app, our WinRT component DLL (`ExpoModulesWindowsCore.dll`) has an unresolvable dependency, which corrupts the package registration. This causes ALL WinRT class activations to fail — including WinAppSDK's `DispatcherQueueController`, which is needed by React Native Windows before any module code runs.

**Why delay-loading didn't help:** Even with `/DELAYLOAD:nethost.dll`, the DLL is still listed in the import table. The MSIX packager still detects the dependency and fails during package validation.

**Fix:** Remove the static link to `nethost.lib` entirely. Instead of calling `get_hostfxr_path()` (from nethost), find `hostfxr.dll` directly by scanning the .NET runtime installation:

```cpp
static std::wstring FindHostFxrPath() {
    namespace fs = std::filesystem;
    std::wstring dotnetRoot;
    wchar_t* envRoot = nullptr;
    size_t envLen = 0;
    if (_wdupenv_s(&envRoot, &envLen, L"DOTNET_ROOT") == 0 && envRoot) {
        dotnetRoot = envRoot;
        free(envRoot);
    }
    if (dotnetRoot.empty())
        dotnetRoot = L"C:\\Program Files\\dotnet";

    auto fxrDir = fs::path(dotnetRoot) / L"host" / L"fxr";
    if (!fs::exists(fxrDir)) return {};

    std::wstring latestVersion;
    for (const auto& entry : fs::directory_iterator(fxrDir))
        if (entry.is_directory()) {
            auto name = entry.path().filename().wstring();
            if (name > latestVersion) latestVersion = name;
        }
    if (latestVersion.empty()) return {};
    return (fxrDir / latestVersion / L"hostfxr.dll").wstring();
}
```

**vcxproj changes:**
- Remove `nethost.lib` from `<AdditionalDependencies>`
- Remove `$(NetHostDir)` from `<AdditionalLibraryDirectories>`
- Remove the `CopyNethost` target
- Keep `NetHost.props` import (still needed for `hostfxr.h` and `coreclr_delegates.h` header include paths)

## Issue 5: VS F5 Deployment — Pre-existing RNW Issue

**Symptom:** `CLASS_NOT_REGISTERED` crash when launching via VS F5 (MSIX debug deployment), even on commits that were previously working.

**Root cause:** This is a pre-existing React Native Windows / Visual Studio MSIX deployment issue, **not caused by our code**. The MSIX package registration becomes stale or corrupted. `Remove-AppxPackage` + clean rebuild does not reliably fix it.

**Workaround:** Use `yarn react-native run-windows` instead of VS F5. This uses a different deployment path that works reliably.

**Discovery:** During bisection, commit `07f9aae` (previously confirmed working) started crashing with VS F5. Switching to `yarn react-native run-windows` confirmed the app works fine on all commits.

## Key Takeaways

1. **Never statically link nethost.lib** in a WinRT component DLL that ships in an MSIX package. Use dynamic hostfxr discovery instead.
2. **Always test with `yarn react-native run-windows`**, not VS F5. VS MSIX deployment is unreliable for this project.
3. **CppWinRT cycle errors are transient** — clean rebuild (possibly multiple times) resolves them.
4. **MSBuild property evaluation** happens before targets run. Properties needed for `AdditionalIncludeDirectories` must use static property functions, not target-based resolution.
