#pragma once

#include "pch.h"
#include "resource.h"

#if __has_include("codegen/NativeExpoModulesWindowsCoreDataTypes.g.h")
  #include "codegen/NativeExpoModulesWindowsCoreDataTypes.g.h"
#endif
// Note: The following lines use Mustache template syntax which will be processed during
// project generation to produce standard C++ code. If existing codegen spec files are found,
// use the actual filename; otherwise use conditional includes.
#if __has_include("codegen/NativeExpoModulesWindowsCoreSpec.g.h")
  #include "codegen/NativeExpoModulesWindowsCoreSpec.g.h"
#endif

#include "NativeModules.h"

namespace winrt::ExpoModulesWindowsCore
{

// See https://microsoft.github.io/react-native-windows/docs/native-platform for help writing native modules

REACT_MODULE(ExpoModulesWindowsCore)
struct ExpoModulesWindowsCore
{
  // Note: Mustache template syntax below will be processed during project generation
  // to produce standard C++ code based on detected codegen files.
#if __has_include("codegen/NativeExpoModulesWindowsCoreSpec.g.h")
  using ModuleSpec = ExpoModulesWindowsCoreCodegen::ExpoModulesWindowsCoreSpec;
#endif

  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  REACT_SYNC_METHOD(multiply)
  double multiply(double a, double b) noexcept;

private:
  React::ReactContext m_context;
};

} // namespace winrt::ExpoModulesWindowsCore