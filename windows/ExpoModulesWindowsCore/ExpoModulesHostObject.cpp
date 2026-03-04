// ExpoModulesHostObject.cpp — Top-level HostObject on global.expo.modules.

#include "pch.h"
#include "ExpoModulesHostObject.h"
#include "ExpoModuleObject.h"

namespace expo {

using namespace facebook::jsi;

ExpoModulesHostObject::ExpoModulesHostObject(
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
    : m_host(host)
    , m_callInvoker(std::move(callInvoker)) {}

Value ExpoModulesHostObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check cache first
    auto it = m_moduleCache.find(nameStr);
    if (it != m_moduleCache.end()) {
        return Object::createFromHostObject(rt, it->second);
    }

    // Look up module by name
    const ModuleInfo* info = m_host.FindModule(nameStr);
    if (!info) {
        return Value::undefined();
    }

    // Create and cache the per-module HostObject
    auto moduleObj = std::make_shared<ExpoModuleObject>(m_host, *info, m_callInvoker);
    m_moduleCache[nameStr] = moduleObj;
    return Object::createFromHostObject(rt, moduleObj);
}

std::vector<PropNameID> ExpoModulesHostObject::getPropertyNames(Runtime& rt) {
    std::vector<PropNameID> names;
    for (const auto& mod : m_host.GetModules()) {
        names.push_back(PropNameID::forUtf8(rt, mod.name));
    }
    return names;
}

} // namespace expo
