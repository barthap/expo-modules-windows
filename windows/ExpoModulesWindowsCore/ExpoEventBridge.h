// ExpoEventBridge.h — Event callback trampoline for C# → JS event dispatch.
// C# calls EventCallbackTrampoline on a ThreadPool thread with typed parameters;
// it copies the data and dispatches to the JS thread via CallInvoker.

#pragma once

#include <memory>
#include <string>
#include <vector>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include "ExpoModulesHostObject.h"
#include "ExpoModuleHost.h"
#include "EventEmitter.h"

namespace expo {

struct EventBridgeContext {
    std::shared_ptr<facebook::react::CallInvoker> callInvoker;
    std::shared_ptr<ExpoModulesHostObject> hostObject;
    ExpoModuleHost* host;
};

// Called from C# ThreadPool thread.
// Signature: (int moduleIndex, uint8_t* eventNameUtf8, int eventNameLen,
//             uint8_t* dataJson, int dataLen, void* userData)
inline void __stdcall EventCallbackTrampoline(
    int moduleIndex,
    uint8_t* eventNameUtf8, int eventNameLen,
    uint8_t* dataJson, int dataLen,
    void* userData)
{
    auto* ctx = static_cast<EventBridgeContext*>(userData);

    // Copy strings — C# buffers are pinned only for the duration of this call
    std::string eventName(reinterpret_cast<char*>(eventNameUtf8),
                          static_cast<size_t>(eventNameLen));
    std::string data(reinterpret_cast<char*>(dataJson),
                     static_cast<size_t>(dataLen));

    auto callInvoker = ctx->callInvoker;
    auto hostObj = ctx->hostObject;

    callInvoker->invokeAsync([hostObj, moduleIndex, eventName = std::move(eventName),
                              data = std::move(data)](facebook::jsi::Runtime& rt) {
        using namespace facebook::jsi;

        auto* moduleObjPtr = hostObj->getModuleJsObject(moduleIndex);
        if (!moduleObjPtr) {
            return;
        }

        // m_moduleJsObjects stores the unwrapped NativeModule object directly
        // (set during LazyObject initialization), so no unwrapping needed.
        Object& emitter = *moduleObjPtr;

        if (!data.empty()) {
            auto jsonBuf = reinterpret_cast<const uint8_t*>(data.data());
            Value dataVal = Value::createFromJsonUtf8(rt, jsonBuf, data.size());
            std::vector<Value> args;
            args.push_back(std::move(dataVal));
            expo::EventEmitter::emitEvent(rt, emitter, eventName, args);
        } else {
            expo::EventEmitter::emitEvent(rt, emitter, eventName, {});
        }
    });
}

} // namespace expo
