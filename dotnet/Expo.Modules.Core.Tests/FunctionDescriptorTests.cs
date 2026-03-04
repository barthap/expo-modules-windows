using Xunit;

namespace Expo.Modules.Core.Tests;

public class FunctionDescriptorTests
{
    [Fact]
    public void Invoke_WithCorrectArgs()
    {
        Func<int, int, int> add = (a, b) => a + b;
        var desc = new FunctionDescriptor("add", add);

        var result = desc.Invoke([3, 7]);
        Assert.Equal(10, result);
    }

    [Fact]
    public void Invoke_NoArgs()
    {
        Func<string> greet = () => "hello";
        var desc = new FunctionDescriptor("greet", greet);

        var result = desc.Invoke([]);
        Assert.Equal("hello", result);
    }

    [Fact]
    public void Invoke_WrongArgCount_Throws()
    {
        Func<int, int> identity = x => x;
        var desc = new FunctionDescriptor("identity", identity);

        Assert.Throws<Exceptions.InvalidArgsException>(() => desc.Invoke([1, 2]));
    }

    [Fact]
    public async Task InvokeAsync_ReturnsResult()
    {
        Func<Task<int>> asyncFn = async () =>
        {
            await Task.Delay(1);
            return 42;
        };
        var desc = new FunctionDescriptor("asyncFn", asyncFn, isAsync: true);

        var result = await desc.InvokeAsync([]);
        Assert.Equal(42, result);
    }

    [Fact]
    public void ParameterTypes_Correct()
    {
        Func<string, int, bool> fn = (s, i) => true;
        var desc = new FunctionDescriptor("fn", fn);

        Assert.Equal([typeof(string), typeof(int)], desc.ParameterTypes);
        Assert.Equal(typeof(bool), desc.ReturnType);
        Assert.False(desc.IsAsync);
    }
}
