using Expo.Modules.Core.Exceptions;
using Xunit;

namespace Expo.Modules.Core.Tests;

public class CodedExceptionTests
{
    [Fact]
    public void ModuleNotFoundException_DeriveCode()
    {
        var ex = new ModuleNotFoundException("Test");
        Assert.Equal("ERR_MODULE_NOT_FOUND", ex.Code);
    }

    [Fact]
    public void FunctionNotFoundException_DeriveCode()
    {
        var ex = new FunctionNotFoundException("Mod", "fn");
        Assert.Equal("ERR_FUNCTION_NOT_FOUND", ex.Code);
    }

    [Fact]
    public void InvalidArgsException_DeriveCode()
    {
        var ex = new InvalidArgsException("bad args");
        Assert.Equal("ERR_INVALID_ARGS", ex.Code);
    }

    [Fact]
    public void CodedException_ExplicitCode()
    {
        var ex = new CodedException("MY_CODE", "msg");
        Assert.Equal("MY_CODE", ex.Code);
    }
}
