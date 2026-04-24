using Expo.Modules.Core.Exceptions;
using Xunit;

namespace Expo.Modules.Core.Tests;

// Test module using the DSL
public class MathModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("Math"),
        Function("add", (int a, int b) => a + b),
        Function("multiply", (double a, double b) => a * b),
        Function("greeting", () => "hello from Math"),
        AsyncFunction("slowAdd", async (int a, int b) =>
        {
            await Task.Delay(1);
            return a + b;
        }),
        Constants(new { pi = 3.14159, e = 2.71828 }),
        Events("onResult", "onError"),
    };
}

public class LifecycleModule : Module
{
    public static bool Created { get; set; }
    public static bool Destroyed { get; set; }

    public override ModuleDefinition Definition() => new()
    {
        Name("Lifecycle"),
        OnCreate(() => Created = true),
        OnDestroy(() => Destroyed = true),
    };
}

public class ModuleRegistryTests
{
    [Fact]
    public void Initialize_CreatesModules()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        Assert.Equal(1, registry.ModuleCount);
    }

    [Fact]
    public void GetModule_ByName()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var module = registry.GetModule("Math");
        Assert.IsType<MathModule>(module);
    }

    [Fact]
    public void GetModule_ByIndex()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var module = registry.GetModule(0);
        Assert.IsType<MathModule>(module);
    }

    [Fact]
    public void GetModule_NotFound_Throws()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        Assert.Throws<ModuleNotFoundException>(() => registry.GetModule("NonExistent"));
    }

    [Fact]
    public void SyncFunction_Invocation()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var def = registry.GetDefinition("Math");
        var result = def.SyncFunctions["add"].Invoke([3, 4]);
        Assert.Equal(7, result);
    }

    [Fact]
    public async Task AsyncFunction_Invocation()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var def = registry.GetDefinition("Math");
        var result = await def.AsyncFunctions["slowAdd"].InvokeAsync([10, 20]);
        Assert.Equal(30, result);
    }

    [Fact]
    public void Constants_Exposed()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var def = registry.GetDefinition("Math");
        Assert.Equal(3.14159, def.ConstantsMap["pi"]);
        Assert.Equal(2.71828, def.ConstantsMap["e"]);
    }

    [Fact]
    public void Events_Registered()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var def = registry.GetDefinition("Math");
        Assert.Contains("onResult", def.EventNames);
        Assert.Contains("onError", def.EventNames);
    }

    [Fact]
    public void Lifecycle_OnCreate_Called()
    {
        LifecycleModule.Created = false;
        LifecycleModule.Destroyed = false;

        var registry = new ModuleRegistry([typeof(LifecycleModule)]);
        registry.Initialize();

        Assert.True(LifecycleModule.Created);
        Assert.False(LifecycleModule.Destroyed);
    }

    [Fact]
    public void Lifecycle_OnDestroy_Called()
    {
        LifecycleModule.Created = false;
        LifecycleModule.Destroyed = false;

        var registry = new ModuleRegistry([typeof(LifecycleModule)]);
        registry.Initialize();
        registry.Destroy();

        Assert.True(LifecycleModule.Destroyed);
    }

    [Fact]
    public void GetManifest_ReturnsCorrectStructure()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var manifest = registry.GetManifest();
        var json = System.Text.Encoding.UTF8.GetString(TypeConverter.Serialize(manifest));

        Assert.Contains("\"Math\"", json);
        Assert.Contains("\"add\"", json);
        Assert.Contains("\"slowAdd\"", json);
    }

    [Fact]
    public void Module_HasAppContext()
    {
        var registry = new ModuleRegistry([typeof(MathModule)]);
        registry.Initialize();

        var module = registry.GetModule(0);
        Assert.NotNull(module.AppContext);
        Assert.Same(registry, module.AppContext!.Registry);
    }
}
