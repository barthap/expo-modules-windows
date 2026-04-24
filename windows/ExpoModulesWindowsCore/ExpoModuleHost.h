// ExpoModuleHost.h — Singleton that manages the .NET runtime via HostFXR
// and provides typed wrappers around the Expo_* C# entry points.

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <functional>
#include <cstdint>
#include <optional>

namespace expo {

// Module metadata parsed from Expo_GetModuleDefinitions JSON
struct ModuleInfo {
    std::string name;
    int index;
    std::vector<std::string> syncFunctions;
    std::vector<std::string> asyncFunctions;
    std::string constantsJson;  // Raw JSON string for constants object
    std::vector<std::string> events;
    struct ViewInfo {
        std::string componentName;
        std::string kind;
        std::vector<std::string> props;
        std::vector<std::string> events;
    };
    std::optional<ViewInfo> view;
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
using Expo_CreateViewFn = int(__stdcall*)(int moduleIdx, int* outViewId);
using Expo_DestroyViewFn = void(__stdcall*)(int viewId);
using Expo_UpdateViewPropsFn = int(__stdcall*)(int viewId, uint8_t* propsJson, int propsLen);
using Expo_InitializeViewCompositionFn = intptr_t(__stdcall*)(int viewId, intptr_t compositorPtr);
using Expo_UpdateViewLayoutFn = void(__stdcall*)(int viewId, float width, float height);

class ExpoModuleHost {
public:
    static ExpoModuleHost& Instance();

    // Full initialization sequence: load HostFXR → init runtime → resolve exports → discover modules → init
    // assemblyDir: directory containing Expo.Modules.Core.dll + runtimeconfig.json
    // providerAssemblyPath: path to DLL containing ExpoModulesProvider (e.g. ExampleModules.dll)
    //   If empty, initializes with no modules.
    void Initialize(const std::wstring& assemblyDir, const std::wstring& providerAssemblyPath);
    void InitializeDefault();

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

    int CreateView(int moduleIdx, int* outViewId);
    void DestroyView(int viewId);
    int UpdateViewProps(int viewId, const std::string& propsJson);
    intptr_t InitializeViewComposition(int viewId, intptr_t compositorPtr);
    void UpdateViewLayout(int viewId, float width, float height);

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
    static std::wstring FindAssemblyDir();
    static std::wstring FindProviderAssemblyPath(const std::wstring& assemblyDir);

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
    Expo_CreateViewFn m_expoCreateView = nullptr;
    Expo_DestroyViewFn m_expoDestroyView = nullptr;
    Expo_UpdateViewPropsFn m_expoUpdateViewProps = nullptr;
    Expo_InitializeViewCompositionFn m_expoInitializeViewComposition = nullptr;
    Expo_UpdateViewLayoutFn m_expoUpdateViewLayout = nullptr;

    // Parsed module metadata
    std::vector<ModuleInfo> m_modules;
    std::unordered_map<std::string, int> m_nameToIndex;
};

} // namespace expo
