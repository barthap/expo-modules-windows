using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Expo.Modules.Core.Exceptions;

namespace Expo.Modules.Core.Interop;

/// <summary>
/// [UnmanagedCallersOnly] entry points called by the C++ host via HostFXR.
/// Memory contract: C# allocates via Marshal.AllocHGlobal, C++ calls Expo_FreeBuffer to release.
/// </summary>
public static class NativeEntryPoints
{
    private static readonly object Lock = new();
    private static ModuleRegistry? _registry;
    private static IntPtr _eventCallbackPtr;

    // ---- Initialization ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_Initialize")]
    public static unsafe int Expo_Initialize(byte* typesJson, int len)
    {
        try
        {
            lock (Lock)
            {
                var json = new ReadOnlySpan<byte>(typesJson, len);
                var typeNames = JsonSerializer.Deserialize<string[]>(json)
                    ?? throw new InvalidArgsException("Failed to deserialize module type names.");

                var types = new Type[typeNames.Length];
                for (int i = 0; i < typeNames.Length; i++)
                {
                    types[i] = Type.GetType(typeNames[i])
                        ?? throw new ModuleNotFoundException(typeNames[i]);
                }

                _registry = new ModuleRegistry(types);
                _registry.Initialize();
                return 0;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Expo_Initialize failed: {ex}");
            return -1;
        }
    }

    // ---- Query ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_GetModuleCount")]
    public static int Expo_GetModuleCount()
    {
        lock (Lock)
        {
            return _registry?.ModuleCount ?? 0;
        }
    }

    [UnmanagedCallersOnly(EntryPoint = "Expo_GetModuleDefinitions")]
    public static unsafe int Expo_GetModuleDefinitions(byte** outJson, int* outLen)
    {
        try
        {
            lock (Lock)
            {
                if (_registry is null)
                {
                    WriteErrorJson(outJson, outLen, "ERR_NOT_INITIALIZED", "Registry not initialized.");
                    return -1;
                }

                var manifest = _registry.GetManifest();
                var json = TypeConverter.Serialize(manifest);
                AllocAndCopy(json, outJson, outLen);
                return 0;
            }
        }
        catch (Exception ex)
        {
            WriteExceptionJson(outJson, outLen, ex);
            return -1;
        }
    }

    // ---- Sync Invocation ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_InvokeSync")]
    public static unsafe int Expo_InvokeSync(
        int moduleIdx,
        byte* funcName, int funcNameLen,
        byte* argsJson, int argsLen,
        byte** resultJson, int* resultLen)
    {
        try
        {
            FunctionDescriptor func;
            lock (Lock)
            {
                if (_registry is null)
                {
                    WriteErrorJson(resultJson, resultLen, "ERR_NOT_INITIALIZED", "Registry not initialized.");
                    return -1;
                }

                var def = _registry.GetDefinition(moduleIdx);
                var name = Encoding.UTF8.GetString(funcName, funcNameLen);

                if (!def.SyncFunctions.TryGetValue(name, out func!))
                    throw new FunctionNotFoundException(def.ModuleName ?? $"index:{moduleIdx}", name);
            }

            var argsSpan = new ReadOnlySpan<byte>(argsJson, argsLen);
            var args = TypeConverter.DeserializeArgs(argsSpan, func.ParameterTypes);
            var result = func.Invoke(args);

            var resultBytes = TypeConverter.Serialize(result);
            AllocAndCopy(resultBytes, resultJson, resultLen);
            return 0;
        }
        catch (Exception ex)
        {
            WriteExceptionJson(resultJson, resultLen, ex);
            return -1;
        }
    }

    // ---- Async Invocation ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_InvokeAsync")]
    public static unsafe int Expo_InvokeAsync(
        int moduleIdx,
        byte* funcName, int funcNameLen,
        byte* argsJson, int argsLen,
        IntPtr callbackPtr)
    {
        try
        {
            FunctionDescriptor func;
            byte[] argsCopy;
            lock (Lock)
            {
                if (_registry is null) return -1;

                var def = _registry.GetDefinition(moduleIdx);
                var name = Encoding.UTF8.GetString(funcName, funcNameLen);

                if (!def.AsyncFunctions.TryGetValue(name, out func!))
                    throw new FunctionNotFoundException(def.ModuleName ?? $"index:{moduleIdx}", name);
            }

            // Copy args before async — the caller's buffer may be freed
            argsCopy = new ReadOnlySpan<byte>(argsJson, argsLen).ToArray();

            // Fire and forget — callback delivers result
            _ = InvokeAsyncCore(func, argsCopy, callbackPtr);
            return 0;
        }
        catch (Exception ex)
        {
            // Deliver error via callback
            DeliverAsyncError(callbackPtr, ex);
            return -1;
        }
    }

    private static async Task InvokeAsyncCore(FunctionDescriptor func, byte[] argsBytes, IntPtr callbackPtr)
    {
        try
        {
            var args = TypeConverter.DeserializeArgs(argsBytes, func.ParameterTypes);
            var result = await func.InvokeAsync(args);
            var resultBytes = TypeConverter.Serialize(result);
            DeliverAsyncResult(callbackPtr, resultBytes, isError: false);
        }
        catch (Exception ex)
        {
            DeliverAsyncError(callbackPtr, ex);
        }
    }

    private static unsafe void DeliverAsyncResult(IntPtr callbackPtr, byte[] json, bool isError)
    {
        var ptr = Marshal.AllocHGlobal(json.Length);
        Marshal.Copy(json, 0, ptr, json.Length);

        var callback = (delegate* unmanaged<byte*, int, int, void>)callbackPtr;
        callback((byte*)ptr, json.Length, isError ? 1 : 0);
        // Note: C++ side must call Expo_FreeBuffer on the ptr
    }

    private static void DeliverAsyncError(IntPtr callbackPtr, Exception ex)
    {
        var error = MakeErrorJson(ex);
        DeliverAsyncResult(callbackPtr, error, isError: true);
    }

    // ---- Event Callback ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_EmitEvent_SetCallback")]
    public static void Expo_EmitEvent_SetCallback(IntPtr callbackPtr)
    {
        lock (Lock)
        {
            _eventCallbackPtr = callbackPtr;

            // Propagate to all modules
            if (_registry is not null)
            {
                for (int i = 0; i < _registry.ModuleCount; i++)
                {
                    _registry.GetModule(i).EventCallbackPtr = callbackPtr;
                }
            }
        }
    }

    // ---- Memory Management ----

    [UnmanagedCallersOnly(EntryPoint = "Expo_FreeBuffer")]
    public static unsafe void Expo_FreeBuffer(byte* ptr)
    {
        if (ptr != null)
        {
            Marshal.FreeHGlobal((IntPtr)ptr);
        }
    }

    // ---- Helpers ----

    private static unsafe void AllocAndCopy(byte[] data, byte** outPtr, int* outLen)
    {
        var ptr = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, ptr, data.Length);
        *outPtr = (byte*)ptr;
        *outLen = data.Length;
    }

    private static unsafe void WriteErrorJson(byte** outPtr, int* outLen, string code, string message)
    {
        var json = MakeErrorJsonBytes(code, message);
        AllocAndCopy(json, outPtr, outLen);
    }

    private static unsafe void WriteExceptionJson(byte** outPtr, int* outLen, Exception ex)
    {
        var json = MakeErrorJson(ex);
        AllocAndCopy(json, outPtr, outLen);
    }

    private static byte[] MakeErrorJson(Exception ex)
    {
        var code = ex is CodedException coded ? coded.Code : "ERR_UNKNOWN";
        var message = ex.Message;
        return MakeErrorJsonBytes(code, message);
    }

    private static byte[] MakeErrorJsonBytes(string code, string message)
    {
        return TypeConverter.Serialize(new { error = code, message });
    }
}
