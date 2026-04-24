using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Expo.Modules.Core;

public static class TypeConverter
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static byte[] Serialize(object? value)
    {
        return JsonSerializer.SerializeToUtf8Bytes(value, Options);
    }

    public static object? Deserialize(ReadOnlySpan<byte> json, Type targetType)
    {
        return JsonSerializer.Deserialize(json, targetType, Options);
    }

    public static object?[] DeserializeArgs(ReadOnlySpan<byte> argsJson, Type[] paramTypes)
    {
        if (paramTypes.Length == 0)
            return [];

        using var doc = JsonDocument.Parse(argsJson.ToArray());
        var root = doc.RootElement;

        if (root.ValueKind != JsonValueKind.Array)
            throw new ArgumentException("Expected JSON array for function arguments.");

        var args = new object?[paramTypes.Length];
        for (int i = 0; i < paramTypes.Length; i++)
        {
            if (i < root.GetArrayLength())
            {
                var element = root[i];
                var rawBytes = Encoding.UTF8.GetBytes(element.GetRawText());
                args[i] = JsonSerializer.Deserialize(rawBytes, paramTypes[i], Options);
            }
            else
            {
                args[i] = paramTypes[i].IsValueType ? Activator.CreateInstance(paramTypes[i]) : null;
            }
        }

        return args;
    }

    internal static object? ConvertArg(object? value, Type targetType)
    {
        if (value is null)
            return targetType.IsValueType ? Activator.CreateInstance(targetType) : null;

        var valueType = value.GetType();
        if (targetType.IsAssignableFrom(valueType))
            return value;

        // For numeric conversions and other simple cases
        try
        {
            return Convert.ChangeType(value, targetType);
        }
        catch
        {
            // Fall back to JSON round-trip for complex conversions
            var json = JsonSerializer.SerializeToUtf8Bytes(value, Options);
            return JsonSerializer.Deserialize(json, targetType, Options);
        }
    }
}
