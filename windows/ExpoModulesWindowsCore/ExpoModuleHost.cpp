// ExpoModuleHost.cpp — .NET runtime loader via HostFXR.
// Ported from test/hostfxr-poc/main.cpp.

#include "pch.h"
#include "ExpoModuleHost.h"

#include <filesystem>
#include <nethost.h>
#include <hostfxr.h>
#include <coreclr_delegates.h>
#include <nlohmann/json.hpp>

// HostFXR function pointers (loaded dynamically)
static hostfxr_initialize_for_runtime_config_fn s_hostfxrInit = nullptr;
static hostfxr_get_runtime_delegate_fn s_hostfxrGetDelegate = nullptr;
static hostfxr_close_fn s_hostfxrClose = nullptr;

namespace expo {

// Assembly-qualified type name for the C# entry points class
static const wchar_t* kEntryPointsTypeName =
    L"Expo.Modules.Core.Interop.NativeEntryPoints, Expo.Modules.Core";

// ---- Helper: resolve one [UnmanagedCallersOnly] export ----

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
        UNMANAGEDCALLERSONLY_METHOD,
        nullptr,
        reinterpret_cast<void**>(outFn));

    if (rc != 0 || !*outFn) {
        OutputDebugStringW((std::wstring(L"ExpoModuleHost: failed to resolve ") +
                           methodName + L"\n").c_str());
        return false;
    }
    return true;
}

// ---- Singleton ----

ExpoModuleHost& ExpoModuleHost::Instance() {
    static ExpoModuleHost instance;
    return instance;
}

// ---- Step 1: Load hostfxr.dll ----

bool ExpoModuleHost::LoadHostFxr() {
    wchar_t hostfxrPath[MAX_PATH];
    size_t pathSize = MAX_PATH;

    int rc = get_hostfxr_path(hostfxrPath, &pathSize, nullptr);
    if (rc != 0) {
        OutputDebugStringA("ExpoModuleHost: get_hostfxr_path failed\n");
        return false;
    }

    HMODULE lib = LoadLibraryW(hostfxrPath);
    if (!lib) {
        OutputDebugStringA("ExpoModuleHost: LoadLibraryW(hostfxr) failed\n");
        return false;
    }

    s_hostfxrInit = reinterpret_cast<hostfxr_initialize_for_runtime_config_fn>(
        GetProcAddress(lib, "hostfxr_initialize_for_runtime_config"));
    s_hostfxrGetDelegate = reinterpret_cast<hostfxr_get_runtime_delegate_fn>(
        GetProcAddress(lib, "hostfxr_get_runtime_delegate"));
    s_hostfxrClose = reinterpret_cast<hostfxr_close_fn>(
        GetProcAddress(lib, "hostfxr_close"));

    if (!s_hostfxrInit || !s_hostfxrGetDelegate || !s_hostfxrClose) {
        OutputDebugStringA("ExpoModuleHost: failed to resolve hostfxr exports\n");
        return false;
    }

    return true;
}

// ---- Step 2: Initialize .NET runtime ----

bool ExpoModuleHost::InitializeRuntime(const std::wstring& runtimeConfigPath) {
    hostfxr_handle ctx = nullptr;
    int rc = s_hostfxrInit(runtimeConfigPath.c_str(), nullptr, &ctx);
    if (rc != 0 && rc != 1) { // 1 = already initialized (ok)
        OutputDebugStringA("ExpoModuleHost: hostfxr_initialize failed\n");
        return false;
    }

    load_assembly_and_get_function_pointer_fn loadAssembly = nullptr;
    rc = s_hostfxrGetDelegate(ctx, hdt_load_assembly_and_get_function_pointer,
                              reinterpret_cast<void**>(&loadAssembly));
    if (rc != 0 || !loadAssembly) {
        OutputDebugStringA("ExpoModuleHost: hdt_load_assembly_and_get_function_pointer failed\n");
        s_hostfxrClose(ctx);
        return false;
    }

    m_loadAssemblyFn = reinterpret_cast<void*>(loadAssembly);
    // Note: we keep the context alive (don't close it) — the runtime stays loaded
    return true;
}

// ---- Step 3: Resolve all Expo_* exports ----

bool ExpoModuleHost::ResolveExports(const std::wstring& assemblyPath) {
    auto loadAssembly = reinterpret_cast<load_assembly_and_get_function_pointer_fn>(m_loadAssemblyFn);
    const wchar_t* tn = kEntryPointsTypeName;

    bool ok = true;
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_Initialize", &m_expoInitialize);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_GetModuleCount", &m_expoGetModuleCount);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_GetModuleDefinitions", &m_expoGetModuleDefinitions);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_InvokeSync", &m_expoInvokeSync);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_InvokeAsync", &m_expoInvokeAsync);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_EmitEvent_SetCallback", &m_expoSetEventCallback);
    ok = ok && resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_FreeBuffer", &m_expoFreeBuffer);

    // Expo_DiscoverModules is optional — don't fail if absent
    resolveExport(loadAssembly, assemblyPath.c_str(), tn, L"Expo_DiscoverModules", &m_expoDiscoverModules);

    return ok;
}

// ---- Step 4: Parse module definitions JSON ----

void ExpoModuleHost::ParseModuleDefinitions(const uint8_t* json, int len) {
    auto j = nlohmann::json::parse(json, json + len);
    m_modules.clear();
    m_nameToIndex.clear();

    for (size_t i = 0; i < j.size(); i++) {
        auto& mod = j[i];
        ModuleInfo info;
        info.name = mod["name"].get<std::string>();
        info.index = static_cast<int>(i);

        for (auto& fn : mod["syncFunctions"]) {
            info.syncFunctions.push_back(fn.get<std::string>());
        }
        for (auto& fn : mod["asyncFunctions"]) {
            info.asyncFunctions.push_back(fn.get<std::string>());
        }
        if (mod.contains("constants") && !mod["constants"].is_null()) {
            info.constantsJson = mod["constants"].dump();
        }
        for (auto& ev : mod["events"]) {
            info.events.push_back(ev.get<std::string>());
        }

        m_nameToIndex[info.name] = static_cast<int>(i);
        m_modules.push_back(std::move(info));
    }
}

// ---- Full initialization sequence ----

void ExpoModuleHost::Initialize(const std::wstring& assemblyDir,
                                const std::wstring& providerAssemblyPath) {
    if (m_initialized) return;

    namespace fs = std::filesystem;
    auto assemblyPath = (fs::path(assemblyDir) / L"Expo.Modules.Core.dll").wstring();
    auto runtimeConfigPath = (fs::path(assemblyDir) / L"Expo.Modules.Core.runtimeconfig.json").wstring();

    // Step 1: Load hostfxr.dll
    if (!LoadHostFxr()) {
        throw std::runtime_error("ExpoModuleHost: failed to load hostfxr");
    }

    // Step 2: Initialize .NET runtime
    if (!InitializeRuntime(runtimeConfigPath)) {
        throw std::runtime_error("ExpoModuleHost: failed to initialize .NET runtime");
    }

    // Step 3: Resolve C# exports
    if (!ResolveExports(assemblyPath)) {
        throw std::runtime_error("ExpoModuleHost: failed to resolve C# exports");
    }

    // Step 4: Discover modules from provider assembly, or use empty list
    std::string moduleTypesJson = "[]";
    if (!providerAssemblyPath.empty() && m_expoDiscoverModules) {
        // Convert wide path to UTF-8
        int utf8Len = WideCharToMultiByte(CP_UTF8, 0, providerAssemblyPath.c_str(),
            static_cast<int>(providerAssemblyPath.size()), nullptr, 0, nullptr, nullptr);
        std::string pathUtf8(utf8Len, '\0');
        WideCharToMultiByte(CP_UTF8, 0, providerAssemblyPath.c_str(),
            static_cast<int>(providerAssemblyPath.size()), pathUtf8.data(), utf8Len, nullptr, nullptr);

        uint8_t* discoveredJson = nullptr;
        int discoveredLen = 0;
        int drc = m_expoDiscoverModules(
            reinterpret_cast<uint8_t*>(pathUtf8.data()),
            static_cast<int>(pathUtf8.size()),
            &discoveredJson, &discoveredLen);

        if (drc == 0 && discoveredJson) {
            moduleTypesJson = std::string(reinterpret_cast<char*>(discoveredJson), discoveredLen);
            m_expoFreeBuffer(discoveredJson);
            OutputDebugStringA(("ExpoModuleHost: discovered modules: " + moduleTypesJson + "\n").c_str());
        } else {
            OutputDebugStringA("ExpoModuleHost: Expo_DiscoverModules failed, using empty module list\n");
            if (discoveredJson) m_expoFreeBuffer(discoveredJson);
        }
    }

    // Step 5: Call Expo_Initialize with module type names
    int rc = m_expoInitialize(
        reinterpret_cast<uint8_t*>(const_cast<char*>(moduleTypesJson.data())),
        static_cast<int>(moduleTypesJson.size()));
    if (rc != 0) {
        throw std::runtime_error("ExpoModuleHost: Expo_Initialize failed (rc=" + std::to_string(rc) + ")");
    }

    // Step 6: Get module definitions
    uint8_t* defsJson = nullptr;
    int defsLen = 0;
    rc = m_expoGetModuleDefinitions(&defsJson, &defsLen);
    if (rc != 0 || !defsJson) {
        throw std::runtime_error("ExpoModuleHost: Expo_GetModuleDefinitions failed");
    }

    ParseModuleDefinitions(defsJson, defsLen);
    m_expoFreeBuffer(defsJson);

    m_initialized = true;

    OutputDebugStringA(("ExpoModuleHost: initialized with " +
                       std::to_string(m_modules.size()) + " modules\n").c_str());
}

// ---- Module lookup ----

const ModuleInfo* ExpoModuleHost::FindModule(const std::string& name) const {
    auto it = m_nameToIndex.find(name);
    if (it == m_nameToIndex.end()) return nullptr;
    return &m_modules[it->second];
}

// ---- Typed wrappers ----

int ExpoModuleHost::InvokeSync(int moduleIdx,
                               const std::string& funcName,
                               const std::string& argsJson,
                               uint8_t** resultJson, int* resultLen) {
    return m_expoInvokeSync(
        moduleIdx,
        reinterpret_cast<uint8_t*>(const_cast<char*>(funcName.data())),
        static_cast<int>(funcName.size()),
        reinterpret_cast<uint8_t*>(const_cast<char*>(argsJson.data())),
        static_cast<int>(argsJson.size()),
        resultJson, resultLen);
}

int ExpoModuleHost::InvokeAsync(int moduleIdx,
                                const std::string& funcName,
                                const std::string& argsJson,
                                void* callbackPtr, void* userDataPtr) {
    return m_expoInvokeAsync(
        moduleIdx,
        reinterpret_cast<uint8_t*>(const_cast<char*>(funcName.data())),
        static_cast<int>(funcName.size()),
        reinterpret_cast<uint8_t*>(const_cast<char*>(argsJson.data())),
        static_cast<int>(argsJson.size()),
        callbackPtr, userDataPtr);
}

void ExpoModuleHost::SetEventCallback(void* callbackPtr, void* userDataPtr) {
    m_expoSetEventCallback(callbackPtr, userDataPtr);
}

void ExpoModuleHost::FreeBuffer(uint8_t* ptr) {
    m_expoFreeBuffer(ptr);
}

} // namespace expo
