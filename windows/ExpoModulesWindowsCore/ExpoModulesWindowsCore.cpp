#include "pch.h"

#include "ExpoModulesWindowsCore.h"
#include "ExpoModuleHost.h"
#include "ExpoModulesHostObject.h"
#include "ExpoEventBridge.h"

// Expo shared C++ layer
#include "EventEmitter.h"
#include "SharedObject.h"
#include "SharedRef.h"
#include "NativeModule.h"

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

            // 1. Create global.expo
            Object expo(rt);
            rt.global().setProperty(rt, "expo", expo);

            // 2. Install class hierarchy (from common/cpp/)
            expo::EventEmitter::installClass(rt);
            expo::SharedObject::installBaseClass(rt, [](expo::SharedObject::ObjectId) {
                // Releaser — called when SharedObject is GC'd.
                // Future: release C# shared objects. No-op for MVP.
            });
            expo::SharedRef::installBaseClass(rt);
            expo::NativeModule::installClass(rt);

            // 3. Install modules host object on global.expo.modules
            auto hostObj = std::make_shared<expo::ExpoModulesHostObject>(host, callInvoker);
            Object expoObj = rt.global().getPropertyAsObject(rt, "expo");
            expoObj.setProperty(rt, "modules",
                Object::createFromHostObject(rt, hostObj));

            // 4. Wire up event bridge — EventBridgeContext holds a shared_ptr
            // to keep the HostObject alive independently of JSI's GC.
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
