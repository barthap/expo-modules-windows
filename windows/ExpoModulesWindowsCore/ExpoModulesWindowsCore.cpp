#include "pch.h"

#include "ExpoModulesWindowsCore.h"
#include "ExpoModuleHost.h"
#include "ExpoModulesHostObject.h"
#include "ExpoEventBridge.h"

#include <filesystem>
#include <JSI/JsiApiContext.h>

namespace winrt::ExpoModulesWindowsCore
{

void ExpoModulesWindowsCore::Initialize(React::ReactContext const &reactContext) noexcept {
    m_context = reactContext;

    try {
        // Initialize the .NET runtime and all C# modules (on REACT_INIT thread)
        auto& host = expo::ExpoModuleHost::Instance();
        host.InitializeDefault();

        auto callInvoker = reactContext.CallInvoker();

        callInvoker->invokeAsync([&host, callInvoker](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;

            Value expoVal = rt.global().getProperty(rt, "expo");
            if (!expoVal.isObject()) {
                throw std::runtime_error(
                    "expo-desktop-modules-core must initialize global.expo before expo-modules-windows-core");
            }

            Object expoObj = expoVal.getObject(rt);
            for (const char* className : {"EventEmitter", "NativeModule"}) {
                if (!expoObj.getProperty(rt, className).isObject()) {
                    throw std::runtime_error(
                        "expo-desktop-modules-core must initialize global.expo Expo classes before expo-modules-windows-core");
                }
            }

            Value modulesVal = expoObj.getProperty(rt, "modules");
            if (!modulesVal.isObject()) {
                throw std::runtime_error(
                    "expo-desktop-modules-core must initialize global.expo.modules before expo-modules-windows-core");
            }
            auto expoDesktopModules = std::make_shared<Object>(modulesVal.getObject(rt));

            auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(
                host, callInvoker, std::move(expoDesktopModules));
            expoObj.setProperty(rt, "modules",
                Object::createFromHostObject(rt, hostObj));

            auto* eventCtx = new expo::EventBridgeContext{
                callInvoker, hostObj, &host
            };
            host.SetEventCallback(
                reinterpret_cast<void*>(&expo::EventCallbackTrampoline),
                reinterpret_cast<void*>(eventCtx));
        });
    }
    catch (const std::exception& ex) {
        m_initError = ex.what();
        auto callInvoker = reactContext.CallInvoker();
        callInvoker->invokeAsync([error = m_initError](facebook::jsi::Runtime& rt) {
            using namespace facebook::jsi;
            Value expoVal = rt.global().getProperty(rt, "expo");
            if (expoVal.isObject()) {
                Object expo = expoVal.getObject(rt);
                expo.setProperty(rt, "__initError",
                    String::createFromUtf8(rt, error));
            }
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
    static const std::wstring kAutolinkedAssembly = L"ExpoModulesAutolinked.dll";

    if (!fs::exists(assemblyDir)) {
        return L"";
    }

    auto autolinkedAssembly = fs::path(assemblyDir) / kAutolinkedAssembly;
    if (fs::exists(autolinkedAssembly)) {
        return autolinkedAssembly.wstring();
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
