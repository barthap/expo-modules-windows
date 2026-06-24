# HostFXR Proof-of-Concept

Standalone C++ console app that loads the .NET runtime via HostFXR and calls C# functions
using `[UnmanagedCallersOnly]` exports. No React Native dependency.

## Purpose

Validate that HostFXR-based C++ to C# interop works correctly before integrating into the
React Native Windows app. This removes RNW as a variable and focuses purely on the bridge.

## Prerequisites

- **.NET 9 SDK** installed (`dotnet --version` should report 9.x)
- **CMake 3.20+** (`cmake --version`)
- **Visual Studio 2022** with C++ desktop workload (for the MSVC compiler)
- .NET SDK must include the `Microsoft.NETCore.App.Host.win-x64` pack (installed by default)

## Project Structure

```
test/hostfxr-poc/
  CMakeLists.txt    - CMake build for the C++ console app
  main.cpp          - HostFXR loader + test harness
  build.bat         - One-click build script (cmd)
  build.sh          - One-click build script (bash)
  README.md         - This file

dotnet/Expo.Modules.HostTest/
  Expo.Modules.HostTest.csproj  - C# class library project
  HostTest.cs                   - [UnmanagedCallersOnly] exported functions
```

## How to Build

### Option A: Build script (recommended)

From the repo root:

```cmd
test\hostfxr-poc\build.bat
```

Or using bash (Git Bash / MSYS2):

```bash
bash test/hostfxr-poc/build.sh
```

### Option B: Manual steps

```cmd
REM 1. Build the C# library
dotnet build dotnet/Expo.Modules.HostTest/Expo.Modules.HostTest.csproj -c Release

REM 2. Configure CMake (from test/hostfxr-poc/)
cd test/hostfxr-poc
cmake -S . -B build -A x64

REM 3. Build
cmake --build build --config Release
```

If CMake cannot find the nethost headers automatically, specify the path:

```cmd
cmake -S . -B build -A x64 -DNETHOST_DIR="C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Host.win-x64\9.0.0\runtimes\win-x64\native"
```

## How to Run

From the **repo root** (so the exe can find the C# assembly via relative path):

```cmd
test\hostfxr-poc\build\Release\hostfxr_poc.exe
```

The program will:

1. Locate and load `hostfxr.dll` via `get_hostfxr_path()`
2. Initialize the .NET runtime using the assembly's `runtimeconfig.json`
3. Resolve 5 `[UnmanagedCallersOnly]` C# functions
4. Run through a series of tests:
   - `ExpoTest_Add(3, 7)` - direct integer arithmetic
   - `ExpoTest_Multiply(3.5, 2.0)` - direct double arithmetic
   - `ExpoTest_GetModuleInfo()` - returns JSON metadata into a caller-provided buffer
   - `ExpoTest_InvokeFunction()` - generic JSON dispatcher (add, multiply, error case)
   - Memory leak test (1000 invoke+free cycles)
   - Per-call overhead benchmark (10,000 direct calls)

## Expected Output

```
=== HostFXR Proof-of-Concept ===

--------------------------------------------------------------
[1] Loading HostFXR...
  hostfxr path: C:\Program Files\dotnet\host\fxr\9.0.0\hostfxr.dll
  OK (X.XX ms)

[2] Initializing .NET runtime...
  OK - runtime initialized (XXX.XX ms)

[3] Resolving C# exports...
  All 5 exports resolved (X.XX ms)

[4] Testing ExpoTest_Add(3, 7)...
  Result: 10 (expected 10) [PASS]

[5] Testing ExpoTest_Multiply(3.5, 2.0)...
  Result: 7.00 (expected 7.00) [PASS]

[6] Testing ExpoTest_GetModuleInfo...
  Result: {"name":"TestModule","functions":["add","multiply"]}
  [PASS]

[7] Testing ExpoTest_InvokeFunction (JSON dispatcher)...
  add({a:10,b:25}) => {"result":35} [PASS]
  multiply({a:6,b:7}) => {"result":42} [PASS]
  unknown(99) => {"error":"Unknown function index: 99"} [PASS - error handled]

[8] Memory leak test (1000 calls)...
  1000 invoke+free cycles: X.XX ms (X.XXXX ms/call)
  [PASS] (no crash = no obvious leak)

[9] Per-call overhead benchmark (10000 direct Add calls)...
  10000 calls: X.XX ms (0.XXXXXX ms/call)
  [PASS] < 1ms per call

=== Summary ===
  Runtime load time: XXX.XX ms [PASS]
  All tests completed.
```

## Validation Checklist

- [ ] HostFXR loads .NET runtime successfully
- [ ] `[UnmanagedCallersOnly]` functions are callable from C++
- [ ] JSON round-trip works (C++ sends JSON args -> C# processes -> returns JSON)
- [ ] Memory management works (C# allocates via `Marshal.AllocHGlobal`, C++ reads, C# frees)
- [ ] Multiple calls don't leak memory
- [ ] Startup time is acceptable (< 500ms for runtime load)
- [ ] Per-call overhead is acceptable (< 1ms for simple function)

## Troubleshooting

**"Cannot find Expo.Modules.HostTest.dll"**
- Build the C# project first: `dotnet build dotnet/Expo.Modules.HostTest -c Release`
- Run the exe from the repo root directory

**"Could not find nethost directory" during CMake**
- Find your .NET SDK host pack:
  `dir "C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Host.win-x64"`
- Pass it to CMake: `-DNETHOST_DIR="<path>/runtimes/win-x64/native"`

**"hostfxr_initialize_for_runtime_config failed"**
- Ensure .NET 9 runtime is installed: `dotnet --list-runtimes`
- Check that `Expo.Modules.HostTest.runtimeconfig.json` exists next to the DLL

**"failed to load ExpoTest_Add"**
- Ensure the C# project built successfully with `AllowUnsafeBlocks`
- Check that the type name matches: `Expo.Modules.HostTest.HostTest, Expo.Modules.HostTest`
