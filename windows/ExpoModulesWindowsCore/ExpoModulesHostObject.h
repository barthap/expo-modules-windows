// ExpoModulesHostObject.h — Top-level JSI HostObject on global.expo.modules.
// Maps module names to LazyObject-wrapped NativeModule instances.

#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <jsi/jsi.h>
#include "ExpoModuleHost.h"

namespace facebook::react {
class CallInvoker;
}

namespace expo {

class ExpoModulesHostObject : public facebook::jsi::HostObject {
public:
    ExpoModulesHostObject(ExpoModuleHost& host,
                          std::shared_ptr<facebook::react::CallInvoker> callInvoker);

    facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                             const facebook::jsi::PropNameID& name) override;

    std::vector<facebook::jsi::PropNameID> getPropertyNames(
        facebook::jsi::Runtime& rt) override;

    // Returns the decorated JS object for a module by index, or nullptr
    // if the module hasn't been accessed from JS yet.
    facebook::jsi::Object* getModuleJsObject(int moduleIndex);

private:
    ExpoModuleHost& m_host;
    std::shared_ptr<facebook::react::CallInvoker> m_callInvoker;

    // All map access must occur on the JS thread (get() via JSI, getModuleJsObject()
    // via callInvoker->invokeAsync). No mutex needed.
    std::unordered_map<std::string, std::shared_ptr<facebook::jsi::Object>> m_moduleCache;
    std::unordered_map<int, std::shared_ptr<facebook::jsi::Object>> m_moduleJsObjects;
};

} // namespace expo
