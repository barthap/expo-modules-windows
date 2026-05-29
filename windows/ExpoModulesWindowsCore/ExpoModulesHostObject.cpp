// ExpoModulesHostObject.cpp — Top-level HostObject on global.expo.modules.

#include "pch.h"
#include "ExpoModulesHostObject.h"
#include "ExpoModuleDecorator.h"
#include "NativeModule.h"
#include "LazyObject.h"

namespace expo {

using namespace facebook::jsi;

ExpoModulesHostObject::ExpoModulesHostObject(
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
    : m_host(host)
    , m_callInvoker(std::move(callInvoker)) {}

Value ExpoModulesHostObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check cache
    auto it = m_moduleCache.find(nameStr);
    if (it != m_moduleCache.end()) {
        return Value(rt, *it->second);
    }

    // Look up module by name
    const ModuleInfo* info = m_host.FindModule(nameStr);
    if (!info) {
        return Value::undefined();
    }

    // Capture everything the LazyObject initializer needs
    ModuleInfo infoCopy = *info;
    ExpoModuleHost* host = &m_host;
    auto callInvoker = m_callInvoker;
    auto* self = this;

    // Create LazyObject — defers NativeModule creation until first property access
    auto lazyObj = std::make_shared<LazyObject>(
        [host, infoCopy, callInvoker, self](Runtime& rt) -> std::shared_ptr<Object> {
            // Create a NativeModule instance (inherits EventEmitter)
            Object moduleObj = expo::NativeModule::createInstance(rt);

            // Decorate with functions, constants, events from the C# manifest
            decorateModuleObject(rt, moduleObj, infoCopy, *host, callInvoker);

            // Store the decorated object for event dispatch
            auto sharedObj = std::make_shared<Object>(std::move(moduleObj));
            self->m_moduleJsObjects[infoCopy.index] = sharedObj;

            return sharedObj;
        });

    // Wrap LazyObject as JSI object, cache, and return
    auto jsObj = std::make_shared<Object>(Object::createFromHostObject(rt, lazyObj));
    m_moduleCache[nameStr] = jsObj;
    return Value(rt, *jsObj);
}

std::vector<PropNameID> ExpoModulesHostObject::getPropertyNames(Runtime& rt) {
    std::vector<PropNameID> names;
    for (const auto& mod : m_host.GetModules()) {
        names.push_back(PropNameID::forUtf8(rt, mod.name));
    }
    return names;
}

Object* ExpoModulesHostObject::getModuleJsObject(int moduleIndex) {
    auto it = m_moduleJsObjects.find(moduleIndex);
    if (it != m_moduleJsObjects.end()) {
        return it->second.get();
    }
    return nullptr;
}

} // namespace expo
