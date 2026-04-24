#include "pch.h"

#include "ReactPackageProvider.h"
#if __has_include("ReactPackageProvider.g.cpp")
#include "ReactPackageProvider.g.cpp"
#endif

#include "ExpoModulesWindowsCore.h"
#include "ExpoViewManager.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::ExpoModulesWindowsCore::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
  AddAttributedModules(packageBuilder, true);
  expo::RegisterExpoViewComponents(packageBuilder);
}

} // namespace winrt::ExpoModulesWindowsCore::implementation
