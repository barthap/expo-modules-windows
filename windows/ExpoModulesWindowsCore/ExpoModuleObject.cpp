// ExpoModuleObject.cpp — Per-module JSI HostObject.

#include "pch.h"
#include "ExpoModuleObject.h"
#include "ExpoMarshal.h"
#include "ExpoAsyncCallback.h"

#include <ReactCommon/CallInvoker.h>

namespace expo {

using namespace facebook::jsi;

ExpoModuleObject::ExpoModuleObject(
    ExpoModuleHost& host,
    const ModuleInfo& moduleInfo,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
    : m_host(host)
    , m_info(moduleInfo)
    , m_callInvoker(std::move(callInvoker))
{
    for (const auto& fn : m_info.syncFunctions)
        m_syncFuncSet.insert(fn);
    for (const auto& fn : m_info.asyncFunctions)
        m_asyncFuncSet.insert(fn);
    for (const auto& ev : m_info.events)
        m_eventSet.insert(ev);
}

Value ExpoModuleObject::get(Runtime& rt, const PropNameID& name) {
    auto nameStr = name.utf8(rt);

    // Check function cache
    auto cacheIt = m_funcCache.find(nameStr);
    if (cacheIt != m_funcCache.end()) {
        return Value(rt, *cacheIt->second);
    }

    // Sync function?
    if (m_syncFuncSet.count(nameStr)) {
        return createSyncFunction(rt, nameStr);
    }

    // Async function?
    if (m_asyncFuncSet.count(nameStr)) {
        return createAsyncFunction(rt, nameStr);
    }

    // Constants? Return the whole constants object as a property
    if (nameStr == "constants" && !m_info.constantsJson.empty()) {
        auto jsonBuf = reinterpret_cast<const uint8_t*>(m_info.constantsJson.data());
        return Value::createFromJsonUtf8(rt, jsonBuf, m_info.constantsJson.size());
    }

    // Also check if nameStr is a key inside constants (flat access pattern)
    // Constants are exposed as top-level properties of the module object
    if (!m_info.constantsJson.empty() && m_info.constantsJson != "{}") {
        // We parse constants lazily on first access to a constant key.
        // For MVP, we return the full constants via the "constants" property above.
        // Individual constant properties can be added if needed.
    }

    // Event listener methods
    if (nameStr == "addListener") {
        return createAddListenerFunction(rt);
    }
    if (nameStr == "removeListeners") {
        return createRemoveListenersFunction(rt);
    }

    return Value::undefined();
}

std::vector<PropNameID> ExpoModuleObject::getPropertyNames(Runtime& rt) {
    std::vector<PropNameID> names;
    for (const auto& fn : m_info.syncFunctions)
        names.push_back(PropNameID::forUtf8(rt, fn));
    for (const auto& fn : m_info.asyncFunctions)
        names.push_back(PropNameID::forUtf8(rt, fn));
    if (!m_info.constantsJson.empty())
        names.push_back(PropNameID::forUtf8(rt, "constants"));
    if (!m_info.events.empty()) {
        names.push_back(PropNameID::forUtf8(rt, "addListener"));
        names.push_back(PropNameID::forUtf8(rt, "removeListeners"));
    }
    return names;
}

// ---- Sync function: serialize args → Expo_InvokeSync → deserialize result ----

Value ExpoModuleObject::createSyncFunction(Runtime& rt, const std::string& funcName) {
    int moduleIdx = m_info.index;
    ExpoModuleHost* host = &m_host;
    std::string fnName = funcName;

    auto func = Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0, // We don't enforce arg count — C# handles validation
        [host, moduleIdx, fnName](Runtime& rt, const Value& thisVal,
                                   const Value* args, size_t count) -> Value {
            // Serialize args to JSON array
            std::string argsJson = jsiArgsToJson(rt, args, count);

            uint8_t* resultJson = nullptr;
            int resultLen = 0;
            int rc = host->InvokeSync(moduleIdx, fnName, argsJson,
                                      &resultJson, &resultLen);

            if (rc != 0) {
                // Error — extract message and throw JSError
                std::string errorMsg = "Unknown error";
                if (resultJson && resultLen > 0) {
                    errorMsg = extractErrorMessage(resultJson, resultLen);
                    host->FreeBuffer(resultJson);
                }
                throw JSError(rt, errorMsg);
            }

            if (!resultJson || resultLen == 0) {
                return Value::undefined();
            }

            // Parse result JSON to JSI value
            Value result = Value::createFromJsonUtf8(rt, resultJson,
                                                     static_cast<size_t>(resultLen));
            host->FreeBuffer(resultJson);
            return result;
        });

    // Cache the function
    auto shared = std::make_shared<Function>(std::move(func));
    m_funcCache[funcName] = shared;
    return Value(rt, *shared);
}

// ---- Async function: return a Promise ----

Value ExpoModuleObject::createAsyncFunction(Runtime& rt, const std::string& funcName) {
    int moduleIdx = m_info.index;
    ExpoModuleHost* host = &m_host;
    std::string fnName = funcName;
    auto callInvoker = m_callInvoker;

    auto func = Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0,
        [host, moduleIdx, fnName, callInvoker](
            Runtime& rt, const Value& thisVal,
            const Value* args, size_t count) -> Value {

            // Serialize args before creating the Promise
            std::string argsJson = jsiArgsToJson(rt, args, count);

            // Get the Promise constructor
            auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");

            // Create a Promise with an executor function
            auto executor = Function::createFromHostFunction(
                rt,
                PropNameID::forUtf8(rt, "executor"),
                2,
                [host, moduleIdx, fnName, argsJson, callInvoker](
                    Runtime& rt, const Value& thisVal,
                    const Value* args, size_t count) -> Value {

                    // args[0] = resolve, args[1] = reject
                    auto resolve = std::make_shared<Function>(args[0].getObject(rt).getFunction(rt));
                    auto reject = std::make_shared<Function>(args[1].getObject(rt).getFunction(rt));

                    // Create async callback context (C++ side owns this, deleted after callback)
                    auto* ctx = new AsyncCallbackContext{
                        callInvoker, resolve, reject, host
                    };

                    // Call C# async function — callback will fire on a ThreadPool thread
                    int rc = host->InvokeAsync(
                        moduleIdx, fnName, argsJson,
                        reinterpret_cast<void*>(&AsyncCallbackTrampoline),
                        reinterpret_cast<void*>(ctx));

                    if (rc != 0) {
                        // Immediate failure — reject the promise
                        auto errMsg = String::createFromUtf8(rt,
                            "InvokeAsync failed for " + fnName + " (rc=" + std::to_string(rc) + ")");
                        reject->call(rt, JSError(rt, std::move(errMsg)).value());
                        delete ctx;
                    }

                    return Value::undefined();
                });

            return promiseCtor.callAsConstructor(rt, std::move(executor));
        });

    auto shared = std::make_shared<Function>(std::move(func));
    m_funcCache[funcName] = shared;
    return Value(rt, *shared);
}

// ---- Event listener methods (MVP stubs) ----

Value ExpoModuleObject::createAddListenerFunction(Runtime& rt) {
    auto cacheIt = m_funcCache.find("addListener");
    if (cacheIt != m_funcCache.end()) {
        return Value(rt, *cacheIt->second);
    }

    auto func = Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, "addListener"),
        2, // (eventName, callback)
        [](Runtime& rt, const Value& thisVal,
           const Value* args, size_t count) -> Value {
            // MVP: no-op. Full event system to be implemented in a later step.
            // The C# side has SendEvent() which calls the event callback,
            // but JS-side routing to specific listeners will be added later.
            return Value::undefined();
        });

    auto shared = std::make_shared<Function>(std::move(func));
    m_funcCache["addListener"] = shared;
    return Value(rt, *shared);
}

Value ExpoModuleObject::createRemoveListenersFunction(Runtime& rt) {
    auto cacheIt = m_funcCache.find("removeListeners");
    if (cacheIt != m_funcCache.end()) {
        return Value(rt, *cacheIt->second);
    }

    auto func = Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, "removeListeners"),
        1, // (count)
        [](Runtime& rt, const Value& thisVal,
           const Value* args, size_t count) -> Value {
            // MVP: no-op
            return Value::undefined();
        });

    auto shared = std::make_shared<Function>(std::move(func));
    m_funcCache["removeListeners"] = shared;
    return Value(rt, *shared);
}

} // namespace expo
