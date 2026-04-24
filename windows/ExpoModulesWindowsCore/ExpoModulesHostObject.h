// ExpoModulesHostObject.h — Top-level JSI HostObject installed on global.expo.modules.
// Maps module names to cached ExpoModuleObject instances.

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

private:
    ExpoModuleHost& m_host;
    std::shared_ptr<facebook::react::CallInvoker> m_callInvoker;
    std::unordered_map<std::string, std::shared_ptr<facebook::jsi::HostObject>> m_moduleCache;
};

} // namespace expo
