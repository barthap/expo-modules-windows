// ExpoModuleHost.h — Singleton that manages the .NET runtime via HostFXR
// and provides typed wrappers around the Expo_* C# entry points.

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <functional>
#include <cstdint>

namespace expo {

// Module metadata parsed from Expo_GetModuleDefinitions JSON
struct ModuleInfo {
    std::string name;
    int index;
    std::vector<std::string> syncFunctions;
    std::vector<std::string> asyncFunctions;
    std::string constantsJson;  // Raw JSON string for constants object
    std::vector<std::string> events;
};

// C# export function signatures (matching NativeEntryPoints.cs)
using Expo_InitializeFn = int(__stdcall*)(uint8_t* typesJson, int len);
using Expo_GetModuleCountFn = int(__stdcall*)();
using Expo_GetModuleDefinitionsFn = int(__stdcall*)(uint8_t** outJson, int* outLen);
using Expo_InvokeSyncFn = int(__stdcall*)(
    int moduleIdx, uint8_t* funcName, int funcNameLen,
    uint8_t* argsJson, int argsLen,
    uint8_t** resultJson, int* resultLen);
using Expo_InvokeAsyncFn = int(__stdcall*)(
    int moduleIdx, uint8_t* funcName, int funcNameLen,
    uint8_t* argsJson, int argsLen,
    void* callbackPtr, void* userDataPtr);
using Expo_EmitEvent_SetCallbackFn = void(__stdcall*)(void* callbackPtr, void* userDataPtr);
using Expo_FreeBufferFn = void(__stdcall*)(uint8_t* ptr);
using Expo_DiscoverModulesFn = int(__stdcall*)(
    uint8_t* assemblyPath, int pathLen,
    uint8_t** outJson, int* outLen);

class ExpoModuleHost {
public:
    static ExpoModuleHost& Instance();

    // Full initialization sequence: load HostFXR → init runtime → resolve exports → discover modules → init
    // assemblyDir: directory containing Expo.Modules.Core.dll + runtimeconfig.json
    // providerAssemblyPath: path to DLL containing ExpoModulesProvider (e.g. ExampleModules.dll)
    //   If empty, initializes with no modules.
    void Initialize(const std::wstring& assemblyDir, const std::wstring& providerAssemblyPath);

    bool IsInitialized() const { return m_initialized; }

    // Module query
    const std::vector<ModuleInfo>& GetModules() const { return m_modules; }
    const ModuleInfo* FindModule(const std::string& name) const;

    // Typed wrappers around C# exports
    // Returns 0 on success. On error, resultJson/resultLen contain error JSON.
    int InvokeSync(int moduleIdx,
                   const std::string& funcName,
                   const std::string& argsJson,
                   uint8_t** resultJson, int* resultLen);

    int InvokeAsync(int moduleIdx,
                    const std::string& funcName,
                    const std::string& argsJson,
                    void* callbackPtr, void* userDataPtr);

    void SetEventCallback(void* callbackPtr, void* userDataPtr);

    void FreeBuffer(uint8_t* ptr);

private:
    ExpoModuleHost() = default;
    ~ExpoModuleHost() = default;
    ExpoModuleHost(const ExpoModuleHost&) = delete;
    ExpoModuleHost& operator=(const ExpoModuleHost&) = delete;

    // Internal steps
    bool LoadHostFxr();
    bool InitializeRuntime(const std::wstring& runtimeConfigPath);
    bool ResolveExports(const std::wstring& assemblyPath);
    void ParseModuleDefinitions(const uint8_t* json, int len);

    // State
    bool m_initialized = false;
    void* m_loadAssemblyFn = nullptr;  // load_assembly_and_get_function_pointer_fn

    // Resolved C# exports
    Expo_InitializeFn m_expoInitialize = nullptr;
    Expo_GetModuleCountFn m_expoGetModuleCount = nullptr;
    Expo_GetModuleDefinitionsFn m_expoGetModuleDefinitions = nullptr;
    Expo_InvokeSyncFn m_expoInvokeSync = nullptr;
    Expo_InvokeAsyncFn m_expoInvokeAsync = nullptr;
    Expo_EmitEvent_SetCallbackFn m_expoSetEventCallback = nullptr;
    Expo_FreeBufferFn m_expoFreeBuffer = nullptr;
    Expo_DiscoverModulesFn m_expoDiscoverModules = nullptr;

    // Parsed module metadata
    std::vector<ModuleInfo> m_modules;
    std::unordered_map<std::string, int> m_nameToIndex;
};

} // namespace expo
