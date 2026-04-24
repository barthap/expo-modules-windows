# Step 3: Build Integration — Post-Mortem

Lessons learned during implementation of build integration (MSBuild targets,
solution structure, managed DLL deployment).

> Historical note:
> Some of the build-shape tradeoffs described here were later superseded by the
> Step 5 autolinking/build integration work. In particular, the example app now
> uses a generated `ExpoModulesAutolinked` hub project and includes managed
> projects in the example solution under a `Managed` folder. See
> `docs/BUILD_SYSTEM.md` for the current structure.

## Issue 1: Member Function Pointer Cast

**Symptom:** `reinterpret_cast: cannot convert from member function pointer to LPCWSTR`

**Root Cause:** `GetModuleHandleExW` with `GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS` requires a plain address within the DLL. The code used `&ExpoModulesWindowsCore::Initialize`, which is a pointer-to-member-function — a fundamentally different type in C++ (it may be larger than a regular pointer and carries vtable offset info).

**Fix:** Use a `static const int s_anchor` variable's address instead. Any static data or function in the DLL works — it just needs to be an address that lives inside the DLL's image.

```cpp
// WRONG: pointer-to-member-function
reinterpret_cast<LPCWSTR>(&ExpoModulesWindowsCore::Initialize)

// CORRECT: address of static variable in this DLL
static const int s_anchor = 0;
reinterpret_cast<LPCWSTR>(&s_anchor)
```

## Issue 2: NetHost.props Multi-Version Resolution

**Symptom:** `MSB4012: expression '@(_NetHostCandidate->'%(RootDir)%(Directory)')\nethost.dll' cannot be used in this context. Item lists cannot be concatenated with other strings where an item list is expected.`

**Root Cause:** When multiple .NET SDK versions are installed, the glob `$(_HostPackBase)\*\runtimes\win-x64\native\nethost.h` matches multiple files. Using `@(_NetHostCandidate->'%(RootDir)%(Directory)')` in a property produces a semicolon-separated list like `path1;path2`. Then `$(NetHostDir)\nethost.dll` in an `Include` attribute fails because MSBuild can't concatenate an item list with a string.

The original code assumed only one .NET SDK version would be installed.

**Fix:** Use MSBuild property functions (`System.IO.Directory::GetDirectories`) to enumerate versions and `String.LastIndexOf(';')` + `Substring` to extract the last (highest) entry — all within static property evaluation.

```xml
<_NetHostVersionDirs>$([System.String]::Join(';', $([System.IO.Directory]::GetDirectories('$(_HostPackBase)'))))</_NetHostVersionDirs>
<_NetHostLatestVersionDir Condition="$(_NetHostVersionDirs.Contains(';'))">
  $(_NetHostVersionDirs.Substring($([MSBuild]::Add($(_NetHostVersionDirs.LastIndexOf(';')), 1))))
</_NetHostLatestVersionDir>
```

**Key constraint:** `NetHostDir` must be resolved during property evaluation (not in a target), because `AdditionalIncludeDirectories` and `AdditionalLibraryDirectories` reference it in `ItemDefinitionGroup`.

## Issue 3: CppWinRT Cyclic Dependency with C# Projects in Solution

**Symptom:** `MSB4006: There is a circular dependency in the target dependency graph involving target 'CppWinRTComputeGetResolvedWinMD'`

**Root Cause:** Adding SDK-style C# projects (GUID `{9A19103F-16F7-4668-BE54-9A1E7A4F7556}`) to a solution that also contains C++/WinRT projects causes the CppWinRT build targets to attempt WinMD resolution from the C# projects. This creates a circular dependency in the MSBuild target graph.

The CppWinRT NuGet package (`Microsoft.Windows.CppWinRT`) hooks into the build to resolve WinMD references from all projects in the solution. When it encounters an SDK-style C# project, it tries to include it in the resolution chain, which conflicts with its own dependency ordering.

**What happened next:** This did not remain the final shape. The app-side build
now uses:

1. a generated `ExpoModulesAutolinked.csproj` hub project,
2. C++ `ProjectReference` metadata tuned for non-WinMD managed references, and
3. `CppWinRTGenerateWindowsMetadata=false` in the app vcxproj.

That lets the example solution include managed projects for navigation and build
ordering without going back to the original failing shape.
