using System.Collections;

namespace Expo.Modules.Core;

public sealed class ViewDefinition<TView> : IDefinitionComponent
    where TView : ExpoView
{
    private readonly ViewDefinition _definition = new();
    private readonly string? _componentName;

    internal ViewDefinition(string? componentName)
    {
        _componentName = componentName;
    }

    public ViewDefinition<TView> Prop<TValue>(string name, Action<TView, TValue?> setter)
    {
        _definition.Props.Add(new ViewPropDescriptor(
            name,
            typeof(TValue),
            (view, value) => setter((TView)view, (TValue?)TypeConverter.ConvertArg(value, typeof(TValue)))));
        return this;
    }

    public ViewDefinition<TView> Events(params string[] names)
    {
        _definition.EventNames.AddRange(names);
        return this;
    }

    public ViewDefinition<TView> OnViewDidUpdateProps(Action<TView> callback)
    {
        _definition.OnViewDidUpdatePropsCallback = view => callback((TView)view);
        return this;
    }

    public ViewDefinition<TView> OnViewDestroys(Action<TView> callback)
    {
        _definition.OnViewDestroysCallback = view => callback((TView)view);
        return this;
    }

    public void Apply(ModuleDefinition definition)
    {
        definition.ViewRegistration = new ViewRegistration(
            typeof(TView),
            () => (ExpoView)Activator.CreateInstance(typeof(TView))!,
            _definition,
            _componentName);
    }
}

public sealed class ViewDefinition : IEnumerable
{
    internal List<ViewPropDescriptor> Props { get; } = [];
    internal List<string> EventNames { get; } = [];
    internal Action<ExpoView>? OnViewDidUpdatePropsCallback { get; set; }
    internal Action<ExpoView>? OnViewDestroysCallback { get; set; }

    public void Add(IViewDefinitionComponent component) => component.Apply(this);

    IEnumerator IEnumerable.GetEnumerator() => throw new NotSupportedException();
}

public interface IViewDefinitionComponent
{
    void Apply(ViewDefinition definition);
}

internal sealed class ViewPropDescriptor(
    string name,
    Type valueType,
    Action<ExpoView, object?> setter)
{
    public string Name { get; } = name;
    public Type ValueType { get; } = valueType;
    internal Action<ExpoView, object?> Setter { get; } = setter;
}

internal sealed class ViewRegistration(
    Type viewType,
    Func<ExpoView> factory,
    ViewDefinition definition,
    string? explicitComponentName)
{
    public Type ViewType { get; } = viewType;
    public Func<ExpoView> Factory { get; } = factory;
    public ViewDefinition Definition { get; } = definition;
    public string? ExplicitComponentName { get; } = explicitComponentName;
    public string ComponentName { get; internal set; } = "";
}

internal sealed class ViewInstance
{
    public required int Id { get; init; }
    public required int ModuleIndex { get; init; }
    public required ExpoView View { get; init; }
    internal required ViewRegistration Registration { get; init; }
}
