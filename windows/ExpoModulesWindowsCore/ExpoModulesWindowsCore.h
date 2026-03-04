#pragma once

#include "pch.h"
#include "resource.h"

#if __has_include("codegen/NativeExpoModulesWindowsCoreDataTypes.g.h")
  #include "codegen/NativeExpoModulesWindowsCoreDataTypes.g.h"
#endif
#if __has_include("codegen/NativeExpoModulesWindowsCoreSpec.g.h")
  #include "codegen/NativeExpoModulesWindowsCoreSpec.g.h"
#endif

#include "NativeModules.h"

namespace winrt::ExpoModulesWindowsCore
{

REACT_MODULE(ExpoModulesWindowsCore)
struct ExpoModulesWindowsCore
{
#if __has_include("codegen/NativeExpoModulesWindowsCoreSpec.g.h")
  using ModuleSpec = ExpoModulesWindowsCoreCodegen::ExpoModulesWindowsCoreSpec;
#endif

  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  // Keep multiply() for now — codegen expects it. Will be removed in step 3.
  REACT_SYNC_METHOD(multiply)
  double multiply(double a, double b) noexcept;

private:
  React::ReactContext m_context;

  // Resolve the directory containing C# assemblies
  std::wstring FindAssemblyDir();

  // Get the module types JSON from autolinking (hardcoded for MVP, generated in step 3)
  std::string GetModuleTypesJson();
};

} // namespace winrt::ExpoModulesWindowsCore
