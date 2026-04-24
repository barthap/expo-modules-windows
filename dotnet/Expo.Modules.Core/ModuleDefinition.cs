using System.Collections;

namespace Expo.Modules.Core;

/// <summary>
/// Marker interface for DSL components that can be added to a ModuleDefinition
/// via collection initializer syntax.
/// </summary>
public interface IDefinitionComponent
{
    void Apply(ModuleDefinition definition);
}

/// <summary>
/// Declarative module definition built via collection initializer DSL.
/// Implements IEnumerable to enable: new ModuleDefinition { Name("X"), Function("y", ...) }
/// </summary>
public class ModuleDefinition : IEnumerable
{
    public string? ModuleName { get; internal set; }

    internal Dictionary<string, FunctionDescriptor> SyncFunctions { get; } = new();
    internal Dictionary<string, FunctionDescriptor> AsyncFunctions { get; } = new();
    internal Dictionary<string, object?> ConstantsMap { get; } = new();
    internal List<string> EventNames { get; } = [];

    internal Action? OnCreateCallback { get; set; }
    internal Action? OnDestroyCallback { get; set; }
    internal Action? OnStartObservingCallback { get; set; }
    internal Action? OnStopObservingCallback { get; set; }

    public void Add(IDefinitionComponent component) => component.Apply(this);

    // Required for collection initializer — never actually enumerate
    IEnumerator IEnumerable.GetEnumerator() => throw new NotSupportedException();
}

// ---- DSL Component Types ----

internal sealed class NameComponent(string name) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def) => def.ModuleName = name;
}

internal sealed class FunctionComponent(FunctionDescriptor descriptor) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def) => def.SyncFunctions[descriptor.Name] = descriptor;
}

internal sealed class AsyncFunctionComponent(FunctionDescriptor descriptor) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def) => def.AsyncFunctions[descriptor.Name] = descriptor;
}

internal sealed class ConstantsComponent(Dictionary<string, object?> constants) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def)
    {
        foreach (var kvp in constants)
            def.ConstantsMap[kvp.Key] = kvp.Value;
    }
}

internal sealed class EventsComponent(string[] names) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def) => def.EventNames.AddRange(names);
}

internal sealed class LifecycleComponent(Action<ModuleDefinition> applier) : IDefinitionComponent
{
    public void Apply(ModuleDefinition def) => applier(def);
}
