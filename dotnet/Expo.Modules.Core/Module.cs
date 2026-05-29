using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace Expo.Modules.Core;

/// <summary>
/// Abstract base class for all Expo modules. Provides the DSL helper methods
/// as protected static members so they're available in Definition() without qualification.
/// </summary>
public abstract class Module
{
    public AppContext? AppContext { get; internal set; }

    internal IntPtr EventCallbackPtr { get; set; }
    internal IntPtr EventUserDataPtr { get; set; }
    internal int ModuleIndex { get; set; }

    public abstract ModuleDefinition Definition();

    /// <summary>
    /// Sends an event to JS listeners. The callback pointer is set by the C++ host
    /// via Expo_EmitEvent_SetCallback.
    /// </summary>
    public unsafe void SendEvent(string name, object? data = null)
    {
        if (EventCallbackPtr == IntPtr.Zero)
            return;

        var nameBytes = Encoding.UTF8.GetBytes(name);
        var dataBytes = data != null ? TypeConverter.Serialize(data) : Array.Empty<byte>();

        fixed (byte* namePtr = nameBytes)
        fixed (byte* dataPtr = dataBytes)
        {
            // Signature: (int moduleIndex, byte* eventNameUtf8, int eventNameLen,
            //             byte* dataJson, int dataLen, IntPtr userData)
            var callback = (delegate* unmanaged<int, byte*, int, byte*, int, IntPtr, void>)EventCallbackPtr;
            callback(ModuleIndex, namePtr, nameBytes.Length, dataPtr, dataBytes.Length, EventUserDataPtr);
        }
    }

    // ---- DSL Helper Methods (protected static) ----

    protected static IDefinitionComponent Name(string name) =>
        new NameComponent(name);

    // Function overloads: 0-4 parameters

    protected static IDefinitionComponent Function<TResult>(string name, Func<TResult> func) =>
        new FunctionComponent(new FunctionDescriptor(name, func));

    protected static IDefinitionComponent Function<T1, TResult>(string name, Func<T1, TResult> func) =>
        new FunctionComponent(new FunctionDescriptor(name, func));

    protected static IDefinitionComponent Function<T1, T2, TResult>(string name, Func<T1, T2, TResult> func) =>
        new FunctionComponent(new FunctionDescriptor(name, func));

    protected static IDefinitionComponent Function<T1, T2, T3, TResult>(string name, Func<T1, T2, T3, TResult> func) =>
        new FunctionComponent(new FunctionDescriptor(name, func));

    protected static IDefinitionComponent Function<T1, T2, T3, T4, TResult>(string name, Func<T1, T2, T3, T4, TResult> func) =>
        new FunctionComponent(new FunctionDescriptor(name, func));

    // AsyncFunction overloads: 0-4 parameters

    protected static IDefinitionComponent AsyncFunction<TResult>(string name, Func<Task<TResult>> func) =>
        new AsyncFunctionComponent(new FunctionDescriptor(name, func, isAsync: true));

    protected static IDefinitionComponent AsyncFunction<T1, TResult>(string name, Func<T1, Task<TResult>> func) =>
        new AsyncFunctionComponent(new FunctionDescriptor(name, func, isAsync: true));

    protected static IDefinitionComponent AsyncFunction<T1, T2, TResult>(string name, Func<T1, T2, Task<TResult>> func) =>
        new AsyncFunctionComponent(new FunctionDescriptor(name, func, isAsync: true));

    protected static IDefinitionComponent AsyncFunction<T1, T2, T3, TResult>(string name, Func<T1, T2, T3, Task<TResult>> func) =>
        new AsyncFunctionComponent(new FunctionDescriptor(name, func, isAsync: true));

    protected static IDefinitionComponent AsyncFunction<T1, T2, T3, T4, TResult>(string name, Func<T1, T2, T3, T4, Task<TResult>> func) =>
        new AsyncFunctionComponent(new FunctionDescriptor(name, func, isAsync: true));

    // Constants, Events, Lifecycle

    protected static IDefinitionComponent Constants(object anonymousObject)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var prop in anonymousObject.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            dict[prop.Name] = prop.GetValue(anonymousObject);
        }
        return new ConstantsComponent(dict);
    }

    protected static IDefinitionComponent Events(params string[] names) =>
        new EventsComponent(names);

    protected static ViewDefinition<TView> View<TView>(string? componentName = null)
        where TView : ExpoView =>
        new(componentName);

    protected static IDefinitionComponent OnCreate(Action callback) =>
        new LifecycleComponent(def => def.OnCreateCallback = callback);

    protected static IDefinitionComponent OnDestroy(Action callback) =>
        new LifecycleComponent(def => def.OnDestroyCallback = callback);

    protected static IDefinitionComponent OnStartObserving(Action callback) =>
        new LifecycleComponent(def => def.OnStartObservingCallback = callback);

    protected static IDefinitionComponent OnStopObserving(Action callback) =>
        new LifecycleComponent(def => def.OnStopObservingCallback = callback);
}
