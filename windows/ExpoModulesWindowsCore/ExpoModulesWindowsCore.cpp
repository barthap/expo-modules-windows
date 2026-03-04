#include "pch.h"

#include "ExpoModulesWindowsCore.h"

namespace winrt::ExpoModulesWindowsCore
{

// See https://microsoft.github.io/react-native-windows/docs/native-platform for help writing native modules

void ExpoModulesWindowsCore::Initialize(React::ReactContext const &reactContext) noexcept {
  m_context = reactContext;
}

double ExpoModulesWindowsCore::multiply(double a, double b) noexcept {
  return a * b;
}

} // namespace winrt::ExpoModulesWindowsCore