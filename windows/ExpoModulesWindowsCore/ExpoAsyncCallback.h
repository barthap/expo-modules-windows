// ExpoAsyncCallback.h — Async callback dispatch for C# → JS Promise resolution.
// The C# side calls AsyncCallbackTrampoline on a ThreadPool thread;
// we use CallInvoker to dispatch back to the JS thread.

#pragma once

#include <memory>
#include <string>
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include "ExpoModuleHost.h"
#include "ExpoMarshal.h"

namespace expo {

struct AsyncCallbackContext {
    std::shared_ptr<facebook::react::CallInvoker> callInvoker;
    std::shared_ptr<facebook::jsi::Function> resolve;
    std::shared_ptr<facebook::jsi::Function> reject;
    ExpoModuleHost* host;
};

// Static trampoline function — called by C# on a ThreadPool thread.
// Signature matches: void(__stdcall*)(uint8_t* resultJson, int len, int isError, void* userData)
inline void __stdcall AsyncCallbackTrampoline(
    uint8_t* resultJson, int len, int isError, void* userData)
{
    auto* ctx = static_cast<AsyncCallbackContext*>(userData);

    // Copy the result data before freeing the C#-allocated buffer
    std::string result(reinterpret_cast<char*>(resultJson), static_cast<size_t>(len));
    ctx->host->FreeBuffer(resultJson);

    // Capture context by shared_ptr so it survives the async dispatch
    auto callInvoker = ctx->callInvoker;
    auto resolve = ctx->resolve;
    auto reject = ctx->reject;
    bool error = (isError != 0);

    // Delete the context now — we've captured everything we need
    delete ctx;

    // Dispatch back to the JS thread
    callInvoker->invokeAsync([resolve, reject, result, error](facebook::jsi::Runtime& rt) {
        using namespace facebook::jsi;

        if (error) {
            std::string errorMsg = extractErrorMessage(
                reinterpret_cast<const uint8_t*>(result.data()),
                static_cast<int>(result.size()));
            auto jsError = String::createFromUtf8(rt, errorMsg);
            reject->call(rt, JSError(rt, std::move(jsError)).value());
        } else {
            if (result.empty() || result == "null") {
                resolve->call(rt, Value::undefined());
            } else {
                auto jsonBuf = reinterpret_cast<const uint8_t*>(result.data());
                Value val = Value::createFromJsonUtf8(rt, jsonBuf, result.size());
                resolve->call(rt, std::move(val));
            }
        }
    });
}

} // namespace expo
