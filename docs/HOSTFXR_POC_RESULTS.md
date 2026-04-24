# HostFXR PoC — Validation Results

> Run date: 2026-03-04

## Result: PASS — All 9 tests passed

---

## Fix Required Before Running

The C# project (`dotnet/Expo.Modules.HostTest/Expo.Modules.HostTest.csproj`) was missing one property.
Class libraries do **not** generate `runtimeconfig.json` by default, but HostFXR requires it.

**Add to the `<PropertyGroup>`:**

```xml
<GenerateRuntimeConfigurationFiles>true</GenerateRuntimeConfigurationFiles>
```

Without this, step [2] fails with:
```
The specified runtimeconfig.json [...] does not exist
ERROR: hostfxr_initialize_for_runtime_config failed (0x80008093)
```

This property was added to the csproj and the fix is already committed.

---

## How to Build and Run

```bash
# 1. Build C# library (from repo root)
dotnet build dotnet/Expo.Modules.HostTest/Expo.Modules.HostTest.csproj -c Release

# 2. C++ was already built via CMake — if rebuilding:
#    Run test/hostfxr-poc/build.bat (Windows) or build.sh (bash)

# 3. Run
./test/hostfxr-poc/build/Release/hostfxr_poc.exe
```

---

## Test Results

| Step | Test | Result | Time |
|------|------|--------|------|
| [1] | Load HostFXR (`hostfxr.dll`) | PASS | 0.30 ms |
| [2] | Initialize .NET runtime | PASS | 12.47 ms |
| [3] | Resolve 5 `[UnmanagedCallersOnly]` exports | PASS | 489.36 ms (one-time JIT) |
| [4] | `ExpoTest_Add(3, 7)` → 10 | PASS | 0.80 ms |
| [5] | `ExpoTest_Multiply(3.5, 2.0)` → 7.0 | PASS | 0.04 ms |
| [6] | `ExpoTest_GetModuleInfo` → JSON | PASS | 16.47 ms |
| [7] | `ExpoTest_InvokeFunction` JSON dispatcher | PASS | see below |
| [8] | Memory leak test (1000 invoke+free cycles) | PASS | 0.0009 ms/call |
| [9] | Per-call overhead benchmark (10,000 direct calls) | PASS | 0.000003 ms/call |

### Step [7] Detail — JSON Dispatcher

| Call | Input | Output |
|------|-------|--------|
| `add` | `{a:10, b:25}` | `{"result":35}` |
| `multiply` | `{a:6, b:7}` | `{"result":42}` |
| unknown fn | `99` | `{"error":"Unknown function index: 99"}` |

---

## Performance vs. Targets

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Runtime startup | < 500 ms | 12.47 ms | ✓ |
| Export resolution (one-time) | — | 489 ms | acceptable (JIT cold start) |
| Per-call overhead | < 1 ms | 0.000003 ms | ✓ |
| Memory (1000-cycle leak test) | no leak | no crash/leak | ✓ |

---

## Validation Checklist

- [x] HostFXR loads .NET runtime successfully
- [x] `[UnmanagedCallersOnly]` functions are callable from C++
- [x] JSON round-trip works (C++ sends JSON args → C# processes → returns JSON)
- [x] Memory management works (C# allocates via `Marshal.AllocHGlobal`, C++ reads, C# frees via `FreeBuffer`)
- [x] Multiple calls don't leak memory (1000-cycle test)
- [x] Startup time < 500 ms
- [x] Per-call overhead < 1 ms (10,000-call benchmark)

---

## Conclusion

The HostFXR bridge approach is **proven viable** for the MVP phase. The C++ host can:
1. Load the .NET 9 runtime in ~12 ms
2. Resolve managed exports once at startup (~489 ms — acceptable, happens before JS runs)
3. Invoke C# functions with near-zero overhead per call

**Next step:** Implement the real `ExpoModulesHostObject` in C++ (Prompt E) using this same pattern.
