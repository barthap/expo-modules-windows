// ExpoModuleDecorator.cpp — Decorates NativeModule instances with C# manifest data.

#include "pch.h"
#include "ExpoModuleDecorator.h"
#include "ExpoMarshal.h"
#include "ExpoAsyncCallback.h"

#include <ReactCommon/CallInvoker.h>

namespace expo {

using namespace facebook::jsi;

static Function createSyncHostFunction(
    Runtime& rt,
    const std::string& funcName,
    int moduleIdx,
    ExpoModuleHost* host)
{
    return Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0,
        [host, moduleIdx, funcName](Runtime& rt, const Value& thisVal,
                                     const Value* args, size_t count) -> Value {
            std::string argsJson = jsiArgsToJson(rt, args, count);

            uint8_t* resultJson = nullptr;
            int resultLen = 0;
            int rc = host->InvokeSync(moduleIdx, funcName, argsJson,
                                      &resultJson, &resultLen);

            if (rc != 0) {
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

            Value result = Value::createFromJsonUtf8(rt, resultJson,
                                                     static_cast<size_t>(resultLen));
            host->FreeBuffer(resultJson);
            return result;
        });
}

static Function createAsyncHostFunction(
    Runtime& rt,
    const std::string& funcName,
    int moduleIdx,
    ExpoModuleHost* host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
{
    return Function::createFromHostFunction(
        rt,
        PropNameID::forUtf8(rt, funcName),
        0,
        [host, moduleIdx, funcName, callInvoker](
            Runtime& rt, const Value& thisVal,
            const Value* args, size_t count) -> Value {

            std::string argsJson = jsiArgsToJson(rt, args, count);

            auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");

            auto executor = Function::createFromHostFunction(
                rt,
                PropNameID::forUtf8(rt, "executor"),
                2,
                [host, moduleIdx, funcName, argsJson, callInvoker](
                    Runtime& rt, const Value& thisVal,
                    const Value* args, size_t count) -> Value {

                    auto resolve = std::make_shared<Function>(args[0].getObject(rt).getFunction(rt));
                    auto reject = std::make_shared<Function>(args[1].getObject(rt).getFunction(rt));

                    auto* ctx = new AsyncCallbackContext{
                        callInvoker, resolve, reject, host
                    };

                    int rc = host->InvokeAsync(
                        moduleIdx, funcName, argsJson,
                        reinterpret_cast<void*>(&AsyncCallbackTrampoline),
                        reinterpret_cast<void*>(ctx));

                    if (rc != 0) {
                        auto errMsg = String::createFromUtf8(rt,
                            "InvokeAsync failed for " + funcName + " (rc=" + std::to_string(rc) + ")");
                        reject->call(rt, JSError(rt, std::move(errMsg)).value());
                        delete ctx;
                    }

                    return Value::undefined();
                });

            return promiseCtor.callAsConstructor(rt, std::move(executor));
        });
}

void decorateModuleObject(
    Runtime& rt,
    Object& moduleObj,
    const ModuleInfo& info,
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker)
{
    int moduleIdx = info.index;
    ExpoModuleHost* hostPtr = &host;

    // Sync functions
    for (const auto& funcName : info.syncFunctions) {
        auto func = createSyncHostFunction(rt, funcName, moduleIdx, hostPtr);
        moduleObj.setProperty(rt, funcName.c_str(), std::move(func));
    }

    // Async functions
    for (const auto& funcName : info.asyncFunctions) {
        auto func = createAsyncHostFunction(rt, funcName, moduleIdx, hostPtr, callInvoker);
        moduleObj.setProperty(rt, funcName.c_str(), std::move(func));
    }

    // Constants — parse JSON object and set each key as a flat property
    if (!info.constantsJson.empty() && info.constantsJson != "{}") {
        auto jsonBuf = reinterpret_cast<const uint8_t*>(info.constantsJson.data());
        Value constantsVal = Value::createFromJsonUtf8(rt, jsonBuf, info.constantsJson.size());
        if (constantsVal.isObject()) {
            Object constantsObj = constantsVal.getObject(rt);
            Array propNames = constantsObj.getPropertyNames(rt);
            size_t len = propNames.size(rt);
            for (size_t i = 0; i < len; i++) {
                String key = propNames.getValueAtIndex(rt, i).getString(rt);
                Value val = constantsObj.getProperty(rt, key);
                moduleObj.setProperty(rt, key, std::move(val));
            }
        }
    }

    // Events — install startObserving/stopObserving as no-ops (MVP)
    if (!info.events.empty()) {
        auto startObserving = Function::createFromHostFunction(
            rt, PropNameID::forUtf8(rt, "startObserving"), 0,
            [](Runtime&, const Value&, const Value*, size_t) -> Value {
                return Value::undefined();
            });
        moduleObj.setProperty(rt, "startObserving", std::move(startObserving));

        auto stopObserving = Function::createFromHostFunction(
            rt, PropNameID::forUtf8(rt, "stopObserving"), 0,
            [](Runtime&, const Value&, const Value*, size_t) -> Value {
                return Value::undefined();
            });
        moduleObj.setProperty(rt, "stopObserving", std::move(stopObserving));
    }

    // Module name identifier
    moduleObj.setProperty(rt, "__expo_module_name__",
        String::createFromUtf8(rt, info.name));
}

} // namespace expo
