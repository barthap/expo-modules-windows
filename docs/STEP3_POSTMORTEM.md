# Step 3: Build Integration — Post-Mortem

Lessons learned during implementation of build integration (MSBuild targets, solution structure, managed DLL deployment).

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

**Current workaround:** C# projects are **not** included in the `.sln` file. Instead, they are built via `dotnet build` Exec tasks in custom MSBuild `.targets` files (`ExpoManagedDeploy.targets`, `ExpoExampleDeploy.targets`), imported by the C++ vcxproj files.

**TODO — Future Resolution:**

This workaround means C# projects don't appear in the VS Solution Explorer, which hurts developer experience (no IntelliSense navigation, no unified debugging, no build order visibility). Possible solutions to investigate:

1. **Separate C# solution/project group:** Use a VS solution filter (`.slnf`) or nested solution that only contains C# projects, opened side-by-side.

2. **`ProjectReference` with `ReferenceOutputAssembly=false`:** Add the C# project as a dependency without WinMD resolution:
   ```xml
   <ProjectReference Include="...\Expo.Modules.Core.csproj">
     <ReferenceOutputAssembly>false</ReferenceOutputAssembly>
     <SkipGetTargetFrameworkProperties>true</SkipGetTargetFrameworkProperties>
     <Private>false</Private>
   </ProjectReference>
   ```

3. **`BuildDependsOn` property:** Instead of `BeforeTargets`, inject the dotnet build into the dependency chain more surgically to avoid the CppWinRT cycle.

4. **CppWinRT configuration:** Look for CppWinRT properties that exclude specific projects from WinMD resolution (e.g., `CppWinRTExcludeProjectReferences`).

5. **Solution folders with build-excluded projects:** Add C# projects to a "Managed" solution folder but uncheck "Build" in Configuration Manager — for code navigation only, while the targets handle actual building.
