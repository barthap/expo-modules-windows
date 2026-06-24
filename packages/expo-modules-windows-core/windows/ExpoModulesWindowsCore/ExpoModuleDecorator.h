// ExpoModuleDecorator.h — Decorates a NativeModule JS instance with
// functions, constants, and events from a C# module manifest.

#pragma once

#include <memory>
#include <jsi/jsi.h>
#include "ExpoModuleHost.h"

namespace facebook::react {
class CallInvoker;
}

namespace expo {

void decorateModuleObject(
    facebook::jsi::Runtime& rt,
    facebook::jsi::Object& moduleObj,
    const ModuleInfo& info,
    ExpoModuleHost& host,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker);

} // namespace expo
