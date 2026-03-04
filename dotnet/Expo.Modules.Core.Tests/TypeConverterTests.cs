using System.Text;
using System.Text.Json;
using Xunit;

namespace Expo.Modules.Core.Tests;

public class TypeConverterTests
{
    [Fact]
    public void RoundTrip_Primitives()
    {
        Assert.Equal(42, Deserialize<int>(TypeConverter.Serialize(42)));
        Assert.Equal(3.14, Deserialize<double>(TypeConverter.Serialize(3.14)));
        Assert.True(Deserialize<bool>(TypeConverter.Serialize(true)));
        Assert.Equal("hello", Deserialize<string>(TypeConverter.Serialize("hello")));
    }

    [Fact]
    public void RoundTrip_Object()
    {
        var obj = new TestPoco { Name = "Alice", Age = 30 };
        var bytes = TypeConverter.Serialize(obj);
        var result = (TestPoco)TypeConverter.Deserialize(bytes, typeof(TestPoco))!;
        Assert.Equal("Alice", result.Name);
        Assert.Equal(30, result.Age);
    }

    [Fact]
    public void RoundTrip_CamelCase()
    {
        var obj = new TestPoco { Name = "Bob", Age = 25 };
        var json = Encoding.UTF8.GetString(TypeConverter.Serialize(obj));
        Assert.Contains("\"name\"", json);
        Assert.Contains("\"age\"", json);
    }

    [Fact]
    public void DeserializeArgs_IntArray()
    {
        var json = Encoding.UTF8.GetBytes("[10, 20]");
        var args = TypeConverter.DeserializeArgs(json, [typeof(int), typeof(int)]);
        Assert.Equal(10, args[0]);
        Assert.Equal(20, args[1]);
    }

    [Fact]
    public void DeserializeArgs_MixedTypes()
    {
        var json = Encoding.UTF8.GetBytes("[\"hello\", 42, true]");
        var args = TypeConverter.DeserializeArgs(json, [typeof(string), typeof(int), typeof(bool)]);
        Assert.Equal("hello", args[0]);
        Assert.Equal(42, args[1]);
        Assert.Equal(true, args[2]);
    }

    [Fact]
    public void DeserializeArgs_EmptyParams()
    {
        var json = Encoding.UTF8.GetBytes("[]");
        var args = TypeConverter.DeserializeArgs(json, []);
        Assert.Empty(args);
    }

    [Fact]
    public void Serialize_Null()
    {
        var bytes = TypeConverter.Serialize(null);
        Assert.Equal("null", Encoding.UTF8.GetString(bytes));
    }

    private static T? Deserialize<T>(byte[] bytes)
    {
        return (T?)TypeConverter.Deserialize(bytes, typeof(T));
    }
}

public class TestPoco
{
    public string Name { get; set; } = "";
    public int Age { get; set; }
}
