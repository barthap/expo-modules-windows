using System.Text;
using System.Runtime.CompilerServices;
using Xunit;

namespace Expo.Modules.Core.Tests;

public sealed class TestView : ExpoView
{
    public string? Color { get; set; }
    public int Count { get; set; }
    public int CommitCount { get; set; }
    public bool Destroyed { get; set; }

    public void CommitProps() => CommitCount++;
}

public sealed class ColorBoxModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("ColorBox"),
        View<TestView>()
            .Prop<string>("color", (view, color) => view.Color = color)
            .Prop<int>("count", (view, count) => view.Count = count)
            .Events("onColorChange")
            .OnViewDidUpdateProps(view => view.CommitProps())
            .OnViewDestroys(view => view.Destroyed = true),
    };
}

public sealed class CustomNamedViewModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("CustomNamed"),
        View<TestView>("SpecialWindowsView"),
    };
}

public class ViewDefinitionTests
{
    [Fact]
    public void View_AddsViewRegistrationToModuleDefinition()
    {
        var definition = new ColorBoxModule().Definition();

        Assert.NotNull(definition.ViewRegistration);
        Assert.Equal(typeof(TestView), definition.ViewRegistration!.ViewType);
        Assert.Equal(["color", "count"], definition.ViewRegistration.Definition.Props.Select(prop => prop.Name));
        Assert.Equal(["onColorChange"], definition.ViewRegistration.Definition.EventNames);
    }

    [Fact]
    public void View_DefaultComponentNameUsesExpoPrefixAndModuleName()
    {
        var registry = new ModuleRegistry([typeof(ColorBoxModule)]);
        registry.Initialize();

        var definition = registry.GetDefinition("ColorBox");

        Assert.Equal("ExpoColorBox", definition.ViewRegistration!.ComponentName);
    }

    [Fact]
    public void View_ComponentNameCanBeOverridden()
    {
        var registry = new ModuleRegistry([typeof(CustomNamedViewModule)]);
        registry.Initialize();

        var definition = registry.GetDefinition("CustomNamed");

        Assert.Equal("SpecialWindowsView", definition.ViewRegistration!.ComponentName);
    }

    [Fact]
    public void ViewRegistry_UpdatePropsAppliesTypedSettersAndLifecycleOnce()
    {
        var registry = new ModuleRegistry([typeof(ColorBoxModule)]);
        registry.Initialize();
        ReplaceFactoryForHeadlessTests(registry);
        var views = new ViewRegistry(registry);

        var viewId = views.CreateView(0);
        views.UpdateProps(viewId, Encoding.UTF8.GetBytes("""{"color":"red","count":3}"""));

        var instance = Assert.IsType<TestView>(views.GetView(viewId).View);
        Assert.Equal("red", instance.Color);
        Assert.Equal(3, instance.Count);
        Assert.Equal(1, instance.CommitCount);
    }

    [Fact]
    public void ViewRegistry_DestroyViewInvokesLifecycle()
    {
        var registry = new ModuleRegistry([typeof(ColorBoxModule)]);
        registry.Initialize();
        ReplaceFactoryForHeadlessTests(registry);
        var views = new ViewRegistry(registry);

        var viewId = views.CreateView(0);
        var instance = Assert.IsType<TestView>(views.GetView(viewId).View);

        views.DestroyView(viewId);

        Assert.True(instance.Destroyed);
    }

    [Fact]
    public void Manifest_IncludesViewMetadata()
    {
        var registry = new ModuleRegistry([typeof(ColorBoxModule)]);
        registry.Initialize();

        var manifest = registry.GetManifest();
        var json = Encoding.UTF8.GetString(TypeConverter.Serialize(manifest));

        Assert.Contains("\"view\":", json);
        Assert.Contains("\"componentName\":\"ExpoColorBox\"", json);
        Assert.Contains("\"kind\":\"composition\"", json);
        Assert.Contains("\"name\":\"color\"", json);
        Assert.Contains("\"type\":\"string\"", json);
        Assert.Contains("\"name\":\"count\"", json);
        Assert.Contains("\"type\":\"number\"", json);
        Assert.Contains("\"onColorChange\"", json);
    }

    private static void ReplaceFactoryForHeadlessTests(ModuleRegistry registry)
    {
        var definition = registry.GetDefinition("ColorBox");
        var original = definition.ViewRegistration!;
        definition.ViewRegistration = new ViewRegistration(
            typeof(TestView),
            () => (TestView)RuntimeHelpers.GetUninitializedObject(typeof(TestView)),
            original.Definition,
            original.ExplicitComponentName)
        {
            ComponentName = original.ComponentName
        };
    }
}
