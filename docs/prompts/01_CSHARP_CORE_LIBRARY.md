# Prompt: C# Core Library — Module Base Class & DSL

**Agent type:** Plan (then implement)
**Priority:** 1 — unblocks everything else
**Dependencies:** HostFXR PoC (done), DSL research (done)

---

```
Implement the C# core library for Expo Modules Windows — the Module base class,
ModuleDefinition DSL, type conversion, and interop entry points.

## Context

We're building "expo-modules-windows-core" — an Expo Modules Core equivalent for
Windows/C#. The HostFXR bridge has been validated (see docs/HOSTFXR_POC_RESULTS.md).
The Expo Modules DSL has been researched (see docs/RESEARCH_DSL.md).

This is the C# library that module authors will depend on. It must provide a clean,
declarative DSL similar to Expo Modules on iOS (Swift) and Android (Kotlin).

## Repository

D:\dev\expo-modules-windows-core
- dotnet/Expo.Modules.HostTest/ — existing HostFXR test (working reference)
- docs/RESEARCH_DSL.md — full DSL component list and architecture
- docs/HOSTFXR_POC_RESULTS.md — proven interop patterns

## Target DX (what module authors write)

```csharp
public class MathModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("Math"),

        Function("add", (int a, int b) => a + b),

        Function("multiply", (double a, double b) => a * b),

        AsyncFunction("computeAsync", async (int n) =>
        {
            await Task.Delay(100);
            return n * n;
        }),

        Constants(new { PI = 3.14159, E = 2.71828 }),

        Events("onResultReady"),

        OnCreate(() => { /* init */ }),
        OnDestroy(() => { /* cleanup */ }),
    };
}
```

## What to implement

Create `dotnet/Expo.Modules.Core/` (.NET 9 class library):

### 1. Module.cs — Abstract base class
- `abstract ModuleDefinition Definition()` — the DSL entry point
- `SendEvent(string name, object? data)` — emit event to JS
- `AppContext` property — access to shared context (ReactContext equivalent)
- Internal: event callback function pointer (set by C++ host at init)

### 2. ModuleDefinition.cs — DSL builder/collector
The DSL should feel natural in C#. Use collection initializer syntax so commas
separate declarations (like the target DX above).

DSL methods (MVP scope):
- `Name(string name)`
- `Function(string name, Delegate body)` — sync function
  Multiple overloads: 0-4 params, typed via generics
  `Function<TResult>(string, Func<TResult>)`
  `Function<T1, TResult>(string, Func<T1, TResult>)`
  `Function<T1, T2, TResult>(string, Func<T1, T2, TResult>)`
  etc.
- `AsyncFunction(string name, Delegate body)` — async, returns Task<T>
  Same overload pattern but with Func<..., Task<TResult>>
- `Constants(object constants)` — anonymous object or dictionary
- `Events(params string[] names)` — declare emittable events
- `OnCreate(Action callback)`
- `OnDestroy(Action callback)`
- `OnStartObserving(Action callback)` — first event listener added
- `OnStopObserving(Action callback)` — last event listener removed

Internal storage:
- `string ModuleName`
- `Dictionary<string, FunctionDescriptor> SyncFunctions`
- `Dictionary<string, FunctionDescriptor> AsyncFunctions`
- `Dictionary<string, object?> ConstantsMap`
- `List<string> EventNames`
- Lifecycle callbacks

### 3. FunctionDescriptor.cs — Metadata about a registered function
- Name, Delegate, ParameterTypes (Type[]), ReturnType, IsAsync
- `object? Invoke(object?[] args)` — calls the delegate with converted args
- `Task<object?> InvokeAsync(object?[] args)` — for async functions

### 4. ModuleRegistry.cs — Module manager
- Accepts a list of Type (from autolinking-generated ExpoModulesProvider)
- Instantiates modules, calls Definition(), caches results
- Provides indexed access: GetModuleCount(), GetModule(int index), GetModule(string name)
- Lifecycle: InitializeAll(), DestroyAll()

### 5. TypeConverter.cs — JSON marshaling
- Serialize C# return values to JSON bytes (System.Text.Json)
- Deserialize JSON argument arrays to C# parameter types
- Handle: primitives (int, double, bool, string), records, List<T>, Dictionary<string,T>,
  enums (string-based), nullable types
- camelCase on JSON side, PascalCase on C# side (JsonNamingPolicy.CamelCase)
- Arguments arrive as a JSON array: [arg1, arg2, ...]

### 6. Interop/NativeEntryPoints.cs — [UnmanagedCallersOnly] methods
These are called by the C++ host via HostFXR. Use the same pattern proven in the PoC.

Entry points:
- `Expo_Initialize(IntPtr moduleTypesJson, int len) → int`
  Receives a JSON array of fully-qualified module class names from autolinking.
  Creates ModuleRegistry, instantiates all modules. Returns 0 on success.

- `Expo_GetModuleCount() → int`

- `Expo_GetModuleDefinitions(byte** outJson, int* outLen) → int`
  Returns JSON array of module definitions:
  [{ "name": "Math", "syncFunctions": ["add","multiply"],
     "asyncFunctions": ["computeAsync"], "constants": {"PI": 3.14}, "events": ["onResultReady"] }]

- `Expo_InvokeSync(int moduleIdx, byte* funcNameUtf8, int funcNameLen,
                     byte* argsJson, int argsLen,
                     byte** resultJson, int* resultLen) → int`
  Returns 0 on success, -1 on error. Error details in resultJson.

- `Expo_InvokeAsync(int moduleIdx, byte* funcNameUtf8, int funcNameLen,
                      byte* argsJson, int argsLen,
                      IntPtr callbackPtr) → int`
  Starts async execution. When done, calls the C++ callback with result.
  Callback signature: void(byte* resultJson, int resultLen, int isError)

- `Expo_EmitEvent_SetCallback(IntPtr callbackPtr) → void`
  C++ passes its event callback. C# stores it for SendEvent().

- `Expo_FreeBuffer(byte* ptr) → void`

### 7. Exceptions
- `CodedException` base class with `Code` property
  Code auto-derived from class name: ModuleNotFoundException → ERR_MODULE_NOT_FOUND
- Exceptions in sync functions → serialized as error JSON to C++
- Exceptions in async functions → passed via callback with isError=1

## Design constraints

- Target `net9.0-windows10.0.19041.0`
- `<GenerateRuntimeConfigurationFiles>true</GenerateRuntimeConfigurationFiles>` (required for HostFXR)
- `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>` (for pointer params in interop)
- Use System.Text.Json with source generators where possible (AOT-friendly)
- Thread safety: C++ may call interop methods from any thread
- Memory: C# allocates via Marshal.AllocHGlobal, C++ reads, then calls Expo_FreeBuffer

## Reference files
- docs/RESEARCH_DSL.md — full DSL component list from expo-modules-core
- dotnet/Expo.Modules.HostTest/HostTest.cs — working interop pattern
- docs/HOSTFXR_POC_RESULTS.md — proven performance numbers

## Output
Write the actual code. Create the .csproj and all .cs files.
Include XML doc comments on public APIs.
```
