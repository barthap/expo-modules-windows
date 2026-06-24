# Relationship With expo-desktop

This package is an expo-desktop add-on for Windows apps. It relies on
expo-desktop for the Expo JS runtime and adds the C# module host plus Windows
autolinking.

## Required Runtime Owner

`expo-desktop-modules-core` initializes:

- `global.expo`
- `global.expo.EventEmitter`
- `global.expo.NativeModule`
- `global.expo.modules`

`expo-modules-windows-core` requires those values to exist before it runs. It
then wraps `global.expo.modules` with a host object that resolves C# modules and
delegates unknown names back to the original expo-desktop object.

## Vendored C++ Layer

The package vendors the MSVC-compatible `common/cpp` Expo runtime files from
expo-desktop:

```text
packages/expo-modules-windows-core/windows/ExpoModulesWindowsCore/common/cpp
```

Those files provide the shared Expo JS classes and helpers used to create
proper `NativeModule` instances. They are compiled into
`ExpoModulesWindowsCore.dll`.

## Version Notes

The current proof path creates an expo-desktop app resolving RNW 0.81.x and
builds with Visual Studio 2022 plus `PlatformToolset=v143`. Use the Visual
Studio/MSBuild requirements of the consuming app's `react-native-windows`
version as the source of truth.

The E2E script currently targets .NET:

```text
net9.0-windows10.0.19041.0
```

Do not switch the target framework independently of RNW/expo-desktop validation;
the acceptance criterion is the running app proof, not only a successful managed
build.

## ExpoView Registration Flag

Windows ExpoView component registration is enabled by default. To disable only
the experimental native view component registration path for local debugging,
set:

```powershell
$env:EXPO_MODULES_WINDOWS_ENABLE_EXPERIMENTAL_VIEWS = '0'
```

Unset the variable, or set it to any value other than `0`, to use the default
enabled behavior. This flag does not disable C# module discovery, constants, or
function calls through `global.expo.modules`.
