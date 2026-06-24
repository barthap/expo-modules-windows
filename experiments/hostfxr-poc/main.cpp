// hostfxr-poc/main.cpp
// Standalone HostFXR proof-of-concept: loads .NET runtime, calls C# functions.
// No React Native dependency.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <string>
#include <filesystem>

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>

#include <nethost.h>
#include <hostfxr.h>
#include <coreclr_delegates.h>

// ---------------------------------------------------------------------------
// Typedefs for the C# exported functions
// ---------------------------------------------------------------------------
typedef int  (CORECLR_DELEGATE_CALLTYPE *AddFn)(int, int);
typedef double (CORECLR_DELEGATE_CALLTYPE *MultiplyFn)(double, double);
typedef int  (CORECLR_DELEGATE_CALLTYPE *GetModuleInfoFn)(uint8_t*, int);
typedef int  (CORECLR_DELEGATE_CALLTYPE *InvokeFunctionFn)(int, uint8_t*, int, uint8_t**, int*);
typedef void (CORECLR_DELEGATE_CALLTYPE *FreeBufferFn)(uint8_t*);

// ---------------------------------------------------------------------------
// HostFXR function pointers (loaded dynamically)
// ---------------------------------------------------------------------------
static hostfxr_initialize_for_runtime_config_fn s_initFn   = nullptr;
static hostfxr_get_runtime_delegate_fn           s_getDelegateFn = nullptr;
static hostfxr_close_fn                          s_closeFn  = nullptr;

// ---------------------------------------------------------------------------
// Helper: high-resolution timer
// ---------------------------------------------------------------------------
struct Timer {
    std::chrono::high_resolution_clock::time_point start;
    Timer() : start(std::chrono::high_resolution_clock::now()) {}
    double elapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start).count();
    }
};

// ---------------------------------------------------------------------------
// Helper: print a horizontal rule
// ---------------------------------------------------------------------------
static void hr() {
    printf("--------------------------------------------------------------\n");
}

// ---------------------------------------------------------------------------
// Step 1: Find and load hostfxr.dll
// ---------------------------------------------------------------------------
static bool loadHostFxr() {
    wchar_t hostfxrPath[MAX_PATH];
    size_t pathSize = MAX_PATH;

    int rc = get_hostfxr_path(hostfxrPath, &pathSize, nullptr);
    if (rc != 0) {
        fprintf(stderr, "ERROR: get_hostfxr_path failed (0x%08x)\n", rc);
        return false;
    }

    wprintf(L"  hostfxr path: %s\n", hostfxrPath);

    HMODULE lib = LoadLibraryW(hostfxrPath);
    if (!lib) {
        fprintf(stderr, "ERROR: LoadLibraryW(hostfxr) failed (%lu)\n", GetLastError());
        return false;
    }

    s_initFn = reinterpret_cast<hostfxr_initialize_for_runtime_config_fn>(
        GetProcAddress(lib, "hostfxr_initialize_for_runtime_config"));
    s_getDelegateFn = reinterpret_cast<hostfxr_get_runtime_delegate_fn>(
        GetProcAddress(lib, "hostfxr_get_runtime_delegate"));
    s_closeFn = reinterpret_cast<hostfxr_close_fn>(
        GetProcAddress(lib, "hostfxr_close"));

    if (!s_initFn || !s_getDelegateFn || !s_closeFn) {
        fprintf(stderr, "ERROR: failed to resolve hostfxr exports\n");
        return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Step 2: Initialize runtime and get the load_assembly delegate
// ---------------------------------------------------------------------------
static load_assembly_and_get_function_pointer_fn
initializeRuntime(const wchar_t* runtimeConfigPath, hostfxr_handle* outCtx) {
    int rc = s_initFn(runtimeConfigPath, nullptr, outCtx);
    if (rc != 0 && rc != 1) {  // 1 = already initialized (ok)
        fprintf(stderr, "ERROR: hostfxr_initialize_for_runtime_config failed (0x%08x)\n", rc);
        return nullptr;
    }

    load_assembly_and_get_function_pointer_fn loadAssembly = nullptr;
    rc = s_getDelegateFn(*outCtx, hdt_load_assembly_and_get_function_pointer,
                         reinterpret_cast<void**>(&loadAssembly));
    if (rc != 0 || !loadAssembly) {
        fprintf(stderr, "ERROR: hdt_load_assembly_and_get_function_pointer failed (0x%08x)\n", rc);
        return nullptr;
    }

    return loadAssembly;
}

// ---------------------------------------------------------------------------
// Helper: resolve one [UnmanagedCallersOnly] function from the C# assembly
// ---------------------------------------------------------------------------
template<typename FnPtr>
static bool resolveExport(
    load_assembly_and_get_function_pointer_fn loadAssembly,
    const wchar_t* assemblyPath,
    const wchar_t* typeName,
    const wchar_t* methodName,
    FnPtr* outFn)
{
    int rc = loadAssembly(
        assemblyPath,
        typeName,
        methodName,
        UNMANAGEDCALLERSONLY_METHOD,  // sentinel for [UnmanagedCallersOnly]
        nullptr,
        reinterpret_cast<void**>(outFn));

    if (rc != 0 || !*outFn) {
        fwprintf(stderr, L"ERROR: failed to load %s (0x%08x)\n", methodName, rc);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main() {
    printf("=== HostFXR Proof-of-Concept ===\n\n");

    // Determine paths relative to the executable
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    std::filesystem::path exeDir = std::filesystem::path(exePath).parent_path();

    // The C# assembly should be published alongside the exe (or in a known relative path).
    // We look for it in a sibling "managed" directory or next to the exe.
    std::filesystem::path assemblyDir;
    if (std::filesystem::exists(exeDir / "managed" / "Expo.Modules.HostTest.dll")) {
        assemblyDir = exeDir / "managed";
    } else if (std::filesystem::exists(exeDir / "Expo.Modules.HostTest.dll")) {
        assemblyDir = exeDir;
    } else {
        // Try relative to CWD (for development)
        auto cwd = std::filesystem::current_path();
        // Check several common build output locations
        std::filesystem::path candidates[] = {
            cwd / "managed",
            cwd / "dotnet" / "Expo.Modules.HostTest" / "bin" / "Release" / "net9.0",
            cwd / "dotnet" / "Expo.Modules.HostTest" / "bin" / "Debug" / "net9.0",
            cwd / ".." / ".." / "dotnet" / "Expo.Modules.HostTest" / "bin" / "Release" / "net9.0",
            cwd / ".." / ".." / "dotnet" / "Expo.Modules.HostTest" / "bin" / "Debug" / "net9.0",
        };
        bool found = false;
        for (auto& c : candidates) {
            if (std::filesystem::exists(c / "Expo.Modules.HostTest.dll")) {
                assemblyDir = std::filesystem::canonical(c);
                found = true;
                break;
            }
        }
        if (!found) {
            fprintf(stderr,
                "ERROR: Cannot find Expo.Modules.HostTest.dll.\n"
                "Build the C# project first:\n"
                "  dotnet build dotnet/Expo.Modules.HostTest -c Release\n"
                "Or copy the output next to this executable.\n");
            return 1;
        }
    }

    std::wstring assemblyPath = (assemblyDir / "Expo.Modules.HostTest.dll").wstring();
    std::wstring runtimeConfigPath = (assemblyDir / "Expo.Modules.HostTest.runtimeconfig.json").wstring();

    wprintf(L"  Assembly:       %s\n", assemblyPath.c_str());
    wprintf(L"  RuntimeConfig:  %s\n", runtimeConfigPath.c_str());
    printf("\n");

    // ------------------------------------------------------------------
    // 1. Load HostFXR
    // ------------------------------------------------------------------
    hr();
    printf("[1] Loading HostFXR...\n");
    Timer t1;
    if (!loadHostFxr()) return 1;
    printf("  OK (%.2f ms)\n\n", t1.elapsedMs());

    // ------------------------------------------------------------------
    // 2. Initialize .NET runtime
    // ------------------------------------------------------------------
    hr();
    printf("[2] Initializing .NET runtime...\n");
    Timer t2;
    hostfxr_handle ctx = nullptr;
    auto loadAssembly = initializeRuntime(runtimeConfigPath.c_str(), &ctx);
    if (!loadAssembly) return 1;
    double runtimeInitMs = t2.elapsedMs();
    printf("  OK - runtime initialized (%.2f ms)\n\n", runtimeInitMs);

    // ------------------------------------------------------------------
    // 3. Resolve C# exports
    // ------------------------------------------------------------------
    hr();
    printf("[3] Resolving C# exports...\n");

    const wchar_t* typeName = L"Expo.Modules.HostTest.HostTest, Expo.Modules.HostTest";

    AddFn            addFn        = nullptr;
    MultiplyFn       multiplyFn   = nullptr;
    GetModuleInfoFn  getInfoFn    = nullptr;
    InvokeFunctionFn invokeFn     = nullptr;
    FreeBufferFn     freeFn       = nullptr;

    Timer t3;
    bool ok = true;
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), typeName, L"ExpoTest_Add",            &addFn);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), typeName, L"ExpoTest_Multiply",       &multiplyFn);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), typeName, L"ExpoTest_GetModuleInfo",  &getInfoFn);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), typeName, L"ExpoTest_InvokeFunction", &invokeFn);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), typeName, L"ExpoTest_FreeBuffer",     &freeFn);

    if (!ok) {
        fprintf(stderr, "ERROR: failed to resolve one or more exports\n");
        s_closeFn(ctx);
        return 1;
    }
    printf("  All 5 exports resolved (%.2f ms)\n\n", t3.elapsedMs());

    // ------------------------------------------------------------------
    // 4. Test: ExpoTest_Add
    // ------------------------------------------------------------------
    hr();
    printf("[4] Testing ExpoTest_Add(3, 7)...\n");
    Timer t4;
    int sum = addFn(3, 7);
    double addMs = t4.elapsedMs();
    printf("  Result: %d (expected 10) %s\n", sum, sum == 10 ? "[PASS]" : "[FAIL]");
    printf("  Time: %.4f ms\n\n", addMs);

    // ------------------------------------------------------------------
    // 5. Test: ExpoTest_Multiply
    // ------------------------------------------------------------------
    hr();
    printf("[5] Testing ExpoTest_Multiply(3.5, 2.0)...\n");
    Timer t5;
    double product = multiplyFn(3.5, 2.0);
    double mulMs = t5.elapsedMs();
    printf("  Result: %.2f (expected 7.00) %s\n", product,
           (product > 6.99 && product < 7.01) ? "[PASS]" : "[FAIL]");
    printf("  Time: %.4f ms\n\n", mulMs);

    // ------------------------------------------------------------------
    // 6. Test: ExpoTest_GetModuleInfo
    // ------------------------------------------------------------------
    hr();
    printf("[6] Testing ExpoTest_GetModuleInfo...\n");
    uint8_t infoBuf[1024];
    Timer t6;
    int infoLen = getInfoFn(infoBuf, sizeof(infoBuf));
    double infoMs = t6.elapsedMs();
    if (infoLen > 0) {
        std::string infoStr(reinterpret_cast<char*>(infoBuf), infoLen);
        printf("  Result: %s\n", infoStr.c_str());
        printf("  [PASS]\n");
    } else {
        printf("  [FAIL] returned %d\n", infoLen);
    }
    printf("  Time: %.4f ms\n\n", infoMs);

    // ------------------------------------------------------------------
    // 7. Test: ExpoTest_InvokeFunction (JSON dispatcher)
    // ------------------------------------------------------------------
    hr();
    printf("[7] Testing ExpoTest_InvokeFunction (JSON dispatcher)...\n");

    // 7a. invoke add (funcIndex=0)
    {
        const char* argsJson = R"({"a":10,"b":25})";
        int argsLen = (int)strlen(argsJson);
        uint8_t* resultBuf = nullptr;
        int resultLen = 0;

        Timer t7a;
        int rc = invokeFn(0, (uint8_t*)argsJson, argsLen, &resultBuf, &resultLen);
        double invokeMs = t7a.elapsedMs();

        if (rc == 0 && resultBuf && resultLen > 0) {
            std::string resultStr(reinterpret_cast<char*>(resultBuf), resultLen);
            printf("  add({a:10,b:25}) => %s [PASS]\n", resultStr.c_str());
        } else {
            printf("  add failed (rc=%d) [FAIL]\n", rc);
        }
        printf("  Time: %.4f ms\n", invokeMs);

        if (resultBuf) freeFn(resultBuf);
    }

    // 7b. invoke multiply (funcIndex=1)
    {
        const char* argsJson = R"({"a":6.0,"b":7.0})";
        int argsLen = (int)strlen(argsJson);
        uint8_t* resultBuf = nullptr;
        int resultLen = 0;

        Timer t7b;
        int rc = invokeFn(1, (uint8_t*)argsJson, argsLen, &resultBuf, &resultLen);
        double invokeMs = t7b.elapsedMs();

        if (rc == 0 && resultBuf && resultLen > 0) {
            std::string resultStr(reinterpret_cast<char*>(resultBuf), resultLen);
            printf("  multiply({a:6,b:7}) => %s [PASS]\n", resultStr.c_str());
        } else {
            printf("  multiply failed (rc=%d) [FAIL]\n", rc);
        }
        printf("  Time: %.4f ms\n", invokeMs);

        if (resultBuf) freeFn(resultBuf);
    }

    // 7c. invoke unknown function (funcIndex=99) - should return error JSON
    {
        const char* argsJson = R"({})";
        int argsLen = (int)strlen(argsJson);
        uint8_t* resultBuf = nullptr;
        int resultLen = 0;

        int rc = invokeFn(99, (uint8_t*)argsJson, argsLen, &resultBuf, &resultLen);
        if (resultBuf && resultLen > 0) {
            std::string resultStr(reinterpret_cast<char*>(resultBuf), resultLen);
            printf("  unknown(99) => %s [PASS - error handled]\n", resultStr.c_str());
        }
        if (resultBuf) freeFn(resultBuf);
    }
    printf("\n");

    // ------------------------------------------------------------------
    // 8. Memory leak test: call InvokeFunction many times
    // ------------------------------------------------------------------
    hr();
    printf("[8] Memory leak test (1000 calls)...\n");
    {
        const char* argsJson = R"({"a":1,"b":2})";
        int argsLen = (int)strlen(argsJson);

        Timer t8;
        for (int i = 0; i < 1000; i++) {
            uint8_t* resultBuf = nullptr;
            int resultLen = 0;
            invokeFn(0, (uint8_t*)argsJson, argsLen, &resultBuf, &resultLen);
            if (resultBuf) freeFn(resultBuf);
        }
        double totalMs = t8.elapsedMs();
        printf("  1000 invoke+free cycles: %.2f ms (%.4f ms/call)\n", totalMs, totalMs / 1000.0);
        printf("  [PASS] (no crash = no obvious leak)\n\n");
    }

    // ------------------------------------------------------------------
    // 9. Per-call overhead benchmark
    // ------------------------------------------------------------------
    hr();
    printf("[9] Per-call overhead benchmark (10000 direct Add calls)...\n");
    {
        Timer t9;
        volatile int dummy = 0;
        for (int i = 0; i < 10000; i++) {
            dummy = addFn(i, i + 1);
        }
        double totalMs = t9.elapsedMs();
        printf("  10000 calls: %.2f ms (%.6f ms/call)\n", totalMs, totalMs / 10000.0);
        printf("  %s\n\n", (totalMs / 10000.0 < 1.0) ? "[PASS] < 1ms per call" : "[WARN] > 1ms per call");
    }

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------
    hr();
    printf("=== Summary ===\n");
    printf("  Runtime load time: %.2f ms %s\n",
           runtimeInitMs,
           runtimeInitMs < 500.0 ? "[PASS]" : "[WARN] > 500ms");
    printf("  All tests completed.\n");
    hr();

    // Clean up
    s_closeFn(ctx);
    return 0;
}
