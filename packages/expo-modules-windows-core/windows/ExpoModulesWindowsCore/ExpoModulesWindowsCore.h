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

#ifdef REACT_EAGER_TURBO_MODULE
REACT_EAGER_TURBO_MODULE(ExpoModulesWindowsCore)
#else
REACT_MODULE(ExpoModulesWindowsCore)
#endif
struct ExpoModulesWindowsCore
{
#if __has_include("codegen/NativeExpoModulesWindowsCoreSpec.g.h")
  using ModuleSpec = ExpoModulesWindowsCoreCodegen::ExpoModulesWindowsCoreSpec;
#endif

  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &reactContext) noexcept;

  REACT_SYNC_METHOD(multiply)
  double multiply(double a, double b) noexcept;

  REACT_SYNC_METHOD(install)
  bool install() noexcept;

private:
  React::ReactContext m_context;
  std::string m_initError;

  // Resolve the directory containing C# assemblies
  std::wstring FindAssemblyDir();

  // Find the provider assembly DLL in the managed/ directory
  std::wstring FindProviderAssemblyPath(const std::wstring& assemblyDir);
};

} // namespace winrt::ExpoModulesWindowsCore
