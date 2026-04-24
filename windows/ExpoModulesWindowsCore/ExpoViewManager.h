#pragma once

#include "ExpoModuleHost.h"

namespace expo {

void RegisterExpoViewComponents(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const& packageBuilder) noexcept;

} // namespace expo
