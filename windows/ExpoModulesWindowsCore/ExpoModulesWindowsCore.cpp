#include "pch.h"

#include "ExpoModulesWindowsCore.h"
#include "ExpoModuleHost.h"
#include "ExpoModulesHostObject.h"

#include <filesystem>
#include <JSI/JsiApiContext.h>

namespace winrt::ExpoModulesWindowsCore
{

void ExpoModulesWindowsCore::Initialize(React::ReactContext const &reactContext) noexcept {
    m_context = reactContext;

    try {
        auto assemblyDir = FindAssemblyDir();
        auto providerPath = FindProviderAssemblyPath(assemblyDir);

        // Initialize the .NET runtime and all C# modules
        auto& host = expo::ExpoModuleHost::Instance();
        host.Initialize(assemblyDir, providerPath);

        // Install the HostObject on global.expo.modules from the JS thread
        auto callInvoker = reactContext.CallInvoker();

        winrt::Microsoft::ReactNative::ExecuteJsi(reactContext,
            [&host, callInvoker](facebook::jsi::Runtime& rt) {
                using namespace facebook::jsi;

                auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(host, callInvoker);

                auto global = rt.global();

                // Get or create global.expo
                Value expoVal = global.getProperty(rt, "expo");
                Object expo = expoVal.isObject()
                    ? expoVal.getObject(rt)
                    : Object(rt);

                // Set global.expo.modules = ExpoModulesHostObject
                expo.setProperty(rt,
                    "modules",
                    Object::createFromHostObject(rt, hostObj));

                global.setProperty(rt, "expo", std::move(expo));
            });

        OutputDebugStringA("ExpoModulesWindowsCore: HostObject installed on global.expo.modules\n");
    }
    catch (const std::exception& ex) {
        OutputDebugStringA(("ExpoModulesWindowsCore: initialization failed: " +
                           std::string(ex.what()) + "\n").c_str());
    }
}

double ExpoModulesWindowsCore::multiply(double a, double b) noexcept {
    return a * b;
}

std::wstring ExpoModulesWindowsCore::FindAssemblyDir() {
    namespace fs = std::filesystem;

    // Get the directory of the current DLL
    // Use a static variable's address (not a member function pointer) for GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
    static const int s_anchor = 0;
    HMODULE hModule = nullptr;
    GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&s_anchor),
        &hModule);

    wchar_t dllPath[MAX_PATH];
    GetModuleFileNameW(hModule, dllPath, MAX_PATH);
    auto dllDir = fs::path(dllPath).parent_path();

    // Probe for the C# assembly in known locations relative to the DLL
    fs::path candidates[] = {
        dllDir / "managed",                               // Standard deployment layout
        dllDir,                                             // Same directory as DLL
        dllDir / ".." / "managed",                         // One level up
    };

    for (auto& dir : candidates) {
        if (fs::exists(dir / "Expo.Modules.Core.dll")) {
            return fs::canonical(dir).wstring();
        }
    }

    // Fallback: try development build paths relative to the project
    // This handles the case where the app is running from VS build output
    auto projectDir = dllDir;
    for (int i = 0; i < 5; i++) {
        auto coreDir = projectDir / "dotnet" / "Expo.Modules.Core" / "bin";
        for (const auto* config : {L"Release", L"Debug"}) {
            auto candidate = coreDir / config / "net9.0-windows10.0.19041.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::canonical(candidate).wstring();
            }
            // Also try without Windows TFM
            candidate = coreDir / config / "net9.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::canonical(candidate).wstring();
            }
        }
        projectDir = projectDir.parent_path();
    }

    throw std::runtime_error("Cannot find Expo.Modules.Core.dll. "
        "Build the C# project first: dotnet build dotnet/Expo.Modules.Core");
}

std::wstring ExpoModulesWindowsCore::FindProviderAssemblyPath(const std::wstring& assemblyDir) {
    namespace fs = std::filesystem;

    // Look for provider DLLs in the managed/ directory.
    // Skip the core assembly — any other DLL is a potential provider.
    static const std::wstring kCoreAssembly = L"Expo.Modules.Core.dll";

    if (!fs::exists(assemblyDir)) {
        return L"";
    }

    for (const auto& entry : fs::directory_iterator(assemblyDir)) {
        if (!entry.is_regular_file()) continue;
        auto filename = entry.path().filename().wstring();
        if (filename == kCoreAssembly) continue;

        // Skip non-DLL files
        auto ext = entry.path().extension().wstring();
        if (ext != L".dll") continue;

        // Skip known .NET framework/system DLLs
        if (filename.starts_with(L"System.") || filename.starts_with(L"Microsoft.")) continue;

        OutputDebugStringW((L"ExpoModulesWindowsCore: found provider assembly: " +
                           entry.path().wstring() + L"\n").c_str());
        return entry.path().wstring();
    }

    OutputDebugStringA("ExpoModulesWindowsCore: no provider assembly found in managed/ dir\n");
    return L"";
}

} // namespace winrt::ExpoModulesWindowsCore
