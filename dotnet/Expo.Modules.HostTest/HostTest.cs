using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Expo.Modules.HostTest;

/// <summary>
/// Static class exposing [UnmanagedCallersOnly] entry points for the HostFXR PoC.
/// Each method uses the "ExpoTest_" prefix so the C++ host can locate them by name.
/// </summary>
public static class HostTest
{
    // -----------------------------------------------------------------------
    // Simple arithmetic exports
    // -----------------------------------------------------------------------

    [UnmanagedCallersOnly(EntryPoint = "ExpoTest_Add")]
    public static int ExpoTest_Add(int a, int b)
    {
        return a + b;
    }

    [UnmanagedCallersOnly(EntryPoint = "ExpoTest_Multiply")]
    public static double ExpoTest_Multiply(double a, double b)
    {
        return a * b;
    }

    // -----------------------------------------------------------------------
    // Module metadata
    // -----------------------------------------------------------------------

    [UnmanagedCallersOnly(EntryPoint = "ExpoTest_GetModuleInfo")]
    public static unsafe int ExpoTest_GetModuleInfo(byte* outBuffer, int bufferLen)
    {
        var info = new
        {
            name = "TestModule",
            functions = new[] { "add", "multiply" }
        };

        string json = JsonSerializer.Serialize(info);
        int byteCount = Encoding.UTF8.GetByteCount(json);

        if (byteCount > bufferLen)
        {
            // Return negative value = required buffer size (caller should retry)
            return -byteCount;
        }

        fixed (char* chars = json)
        {
            Encoding.UTF8.GetBytes(chars, json.Length, outBuffer, bufferLen);
        }

        return byteCount;
    }

    // -----------------------------------------------------------------------
    // Generic JSON dispatcher
    // -----------------------------------------------------------------------

    [UnmanagedCallersOnly(EntryPoint = "ExpoTest_InvokeFunction")]
    public static unsafe int ExpoTest_InvokeFunction(
        int funcIndex,
        byte* argsJson,
        int argsLen,
        byte** resultJson,
        int* resultLen)
    {
        try
        {
            string argsStr = Encoding.UTF8.GetString(argsJson, argsLen);
            string resultStr;

            switch (funcIndex)
            {
                case 0: // add
                {
                    using var doc = JsonDocument.Parse(argsStr);
                    var root = doc.RootElement;
                    int a = root.GetProperty("a").GetInt32();
                    int b = root.GetProperty("b").GetInt32();
                    int sum = a + b;
                    resultStr = JsonSerializer.Serialize(new { result = sum });
                    break;
                }
                case 1: // multiply
                {
                    using var doc = JsonDocument.Parse(argsStr);
                    var root = doc.RootElement;
                    double a = root.GetProperty("a").GetDouble();
                    double b = root.GetProperty("b").GetDouble();
                    double product = a * b;
                    resultStr = JsonSerializer.Serialize(new { result = product });
                    break;
                }
                default:
                    resultStr = JsonSerializer.Serialize(new { error = $"Unknown function index: {funcIndex}" });
                    break;
            }

            byte[] resultBytes = Encoding.UTF8.GetBytes(resultStr);
            IntPtr ptr = Marshal.AllocHGlobal(resultBytes.Length);
            Marshal.Copy(resultBytes, 0, ptr, resultBytes.Length);

            *resultJson = (byte*)ptr;
            *resultLen = resultBytes.Length;

            return 0; // success
        }
        catch (Exception ex)
        {
            string errorJson = JsonSerializer.Serialize(new { error = ex.Message });
            byte[] errorBytes = Encoding.UTF8.GetBytes(errorJson);
            IntPtr ptr = Marshal.AllocHGlobal(errorBytes.Length);
            Marshal.Copy(errorBytes, 0, ptr, errorBytes.Length);

            *resultJson = (byte*)ptr;
            *resultLen = errorBytes.Length;

            return -1; // error
        }
    }

    // -----------------------------------------------------------------------
    // Memory management
    // -----------------------------------------------------------------------

    [UnmanagedCallersOnly(EntryPoint = "ExpoTest_FreeBuffer")]
    public static unsafe void ExpoTest_FreeBuffer(byte* ptr)
    {
        if (ptr != null)
        {
            Marshal.FreeHGlobal((IntPtr)ptr);
        }
    }
}
