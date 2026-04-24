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
        // Initialize the .NET runtime and all C# modules
        auto& host = expo::ExpoModuleHost::Instance();
        host.InitializeDefault();

        // Install the HostObject on global.expo.modules via callInvoker.
        // invokeAsync queues onto the JS thread — guaranteed to run once the
        // runtime is live, unlike ExecuteJsi which silently drops from REACT_INIT.
        auto callInvoker = reactContext.CallInvoker();
        auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(host, callInvoker);

        callInvoker->invokeAsync([hostObj = std::move(hostObj)](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;

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
    }
    catch (const std::exception& ex) {
        m_initError = ex.what();
        auto callInvoker = reactContext.CallInvoker();
        callInvoker->invokeAsync([error = m_initError](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;
            auto global = rt.global();
            Object expo(rt);
            expo.setProperty(rt, "__initError",
                String::createFromUtf8(rt, error));
            global.setProperty(rt, "expo", std::move(expo));
        });
    }
    catch (...) {
        m_initError = "unknown native exception during .NET initialization";
    }
}

double ExpoModulesWindowsCore::multiply(double a, double b) noexcept {
    return a * b;
}

bool ExpoModulesWindowsCore::install() noexcept {
    // No-op — kept for backward compat with the TurboModule spec.
    // HostObject is now installed via callInvoker in REACT_INIT.
    return m_initError.empty();
}

std::wstring ExpoModulesWindowsCore::FindAssemblyDir() {
    namespace fs = std::filesystem;

    static const int s_anchor = 0;
    HMODULE hModule = nullptr;
    GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&s_anchor),
        &hModule);

    wchar_t dllPath[MAX_PATH];
    GetModuleFileNameW(hModule, dllPath, MAX_PATH);
    auto dllDir = fs::path(dllPath).parent_path();

    fs::path candidates[] = {
        dllDir / "managed",
        dllDir,
        dllDir / ".." / "managed",
    };

    for (auto& dir : candidates) {
        if (fs::exists(dir / "Expo.Modules.Core.dll")) {
            return fs::weakly_canonical(dir).wstring();
        }
    }

    auto projectDir = dllDir;
    for (int i = 0; i < 5; i++) {
        auto coreDir = projectDir / "dotnet" / "Expo.Modules.Core" / "bin";
        for (const auto* config : {L"Release", L"Debug"}) {
            auto candidate = coreDir / config / "net9.0-windows10.0.19041.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::weakly_canonical(candidate).wstring();
            }
            candidate = coreDir / config / "net9.0";
            if (fs::exists(candidate / "Expo.Modules.Core.dll")) {
                return fs::weakly_canonical(candidate).wstring();
            }
        }
        projectDir = projectDir.parent_path();
    }

    throw std::runtime_error("Cannot find Expo.Modules.Core.dll. "
        "Build the C# project first: dotnet build dotnet/Expo.Modules.Core");
}

std::wstring ExpoModulesWindowsCore::FindProviderAssemblyPath(const std::wstring& assemblyDir) {
    namespace fs = std::filesystem;

    static const std::wstring kCoreAssembly = L"Expo.Modules.Core.dll";

    if (!fs::exists(assemblyDir)) {
        return L"";
    }

    for (const auto& entry : fs::directory_iterator(assemblyDir)) {
        if (!entry.is_regular_file()) continue;
        auto filename = entry.path().filename().wstring();
        if (filename == kCoreAssembly) continue;

        auto ext = entry.path().extension().wstring();
        if (ext != L".dll") continue;

        if (filename.starts_with(L"System.") || filename.starts_with(L"Microsoft.")) continue;

        return entry.path().wstring();
    }

    return L"";
}

} // namespace winrt::ExpoModulesWindowsCore
