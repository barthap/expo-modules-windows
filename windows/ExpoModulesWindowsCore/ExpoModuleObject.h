// ExpoModuleObject.h — Per-module JSI HostObject.
// Exposes sync functions, async functions, constants, and event methods
// for a single C# Expo module.

#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <jsi/jsi.h>
#include "ExpoModuleHost.h"

namespace facebook::react {
class CallInvoker;
}

namespace expo {

class ExpoModuleObject : public facebook::jsi::HostObject {
public:
    ExpoModuleObject(ExpoModuleHost& host,
                     const ModuleInfo& moduleInfo,
                     std::shared_ptr<facebook::react::CallInvoker> callInvoker);

    facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                             const facebook::jsi::PropNameID& name) override;

    std::vector<facebook::jsi::PropNameID> getPropertyNames(
        facebook::jsi::Runtime& rt) override;

private:
    facebook::jsi::Value createSyncFunction(facebook::jsi::Runtime& rt,
                                            const std::string& funcName);
    facebook::jsi::Value createAsyncFunction(facebook::jsi::Runtime& rt,
                                             const std::string& funcName);
    facebook::jsi::Value createAddListenerFunction(facebook::jsi::Runtime& rt);
    facebook::jsi::Value createRemoveListenersFunction(facebook::jsi::Runtime& rt);

    ExpoModuleHost& m_host;
    ModuleInfo m_info;
    std::shared_ptr<facebook::react::CallInvoker> m_callInvoker;

    // Sets for fast lookup
    std::unordered_set<std::string> m_syncFuncSet;
    std::unordered_set<std::string> m_asyncFuncSet;
    std::unordered_set<std::string> m_eventSet;

    // Cache of already-created JSI values (keyed by property name)
    std::unordered_map<std::string, std::shared_ptr<facebook::jsi::Function>> m_funcCache;
};

} // namespace expo
