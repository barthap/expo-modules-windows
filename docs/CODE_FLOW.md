# Code Flow

This package requires expo-desktop's Windows Expo runtime. It does not create
`global.expo`.

## Startup

1. expo-desktop initializes the app and installs `global.expo`.
2. expo-desktop creates the initial `global.expo.modules` object with its
   stubs.
3. React Native Windows loads `ExpoModulesWindowsCore`.
4. `ExpoModulesWindowsCore` verifies that `global.expo`,
   `global.expo.NativeModule`, `global.expo.EventEmitter`, and
   `global.expo.modules` already exist.
5. The package replaces `global.expo.modules` with a host object that serves C#
   modules and delegates unknown names back to expo-desktop's original modules
   object.

If expo-desktop has not initialized the runtime, initialization fails with a
clear error naming `expo-desktop-modules-core`.

## Module Call

For this C# module:

```csharp
public sealed class LocalCounterModule : Module
{
    private int _count;

    public override ModuleDefinition Definition() => new()
    {
        Name("LocalCounter"),
        Function<int>("increment", () => ++_count)
    };
}
```

JS calls:

```js
global.expo.modules.LocalCounter.increment()
```

Flow:

1. JS reads `global.expo.modules.LocalCounter`.
2. `ExpoModulesHostObject` resolves the module metadata discovered from the
   managed provider.
3. A lazy Expo `NativeModule` instance is created using the C++ runtime classes
   supplied by expo-desktop's shared C++ layer.
4. `ExpoModuleDecorator` attaches functions and constants from the C# manifest.
5. The function call crosses JSI into C++.
6. `ExpoModuleHost` dispatches to .NET through HostFXR.
7. `Expo.Modules.Core` invokes the C# function descriptor and returns JSON.
8. `ExpoMarshal` converts JSON back into JSI values.

Unknown module names are delegated to the original expo-desktop modules object,
so stubs such as `NativeModulesProxy`, `ExpoAsset`, and `ExponentConstants`
remain available.
