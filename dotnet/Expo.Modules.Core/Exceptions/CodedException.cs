using System.Text.RegularExpressions;

namespace Expo.Modules.Core.Exceptions;

/// <summary>
/// Base exception for all Expo module errors. Derives an error code from the class name.
/// e.g. ModuleNotFoundException → "ERR_MODULE_NOT_FOUND"
/// </summary>
public partial class CodedException : Exception
{
    public string Code { get; }

    public CodedException(string code, string message) : base(message)
    {
        Code = code;
    }

    public CodedException(string message) : base(message)
    {
        Code = DeriveCode(GetType());
    }

    public CodedException() : base()
    {
        Code = DeriveCode(GetType());
    }

    private static string DeriveCode(Type type)
    {
        var name = type.Name;

        // Strip "Exception" suffix
        if (name.EndsWith("Exception"))
            name = name[..^"Exception".Length];

        // Split PascalCase → UPPER_SNAKE_CASE
        var snake = PascalCaseRegex().Replace(name, "$1_$2").ToUpperInvariant();

        return $"ERR_{snake}";
    }

    [GeneratedRegex("([a-z0-9])([A-Z])")]
    private static partial Regex PascalCaseRegex();
}

public class ModuleNotFoundException : CodedException
{
    public ModuleNotFoundException(string moduleName)
        : base($"Module '{moduleName}' not found.") { }
}

public class FunctionNotFoundException : CodedException
{
    public FunctionNotFoundException(string moduleName, string functionName)
        : base($"Function '{functionName}' not found in module '{moduleName}'.") { }
}

public class InvalidArgsException : CodedException
{
    public InvalidArgsException(string message)
        : base(message) { }
}
