using System.Text.Json;

namespace Expo.Modules.Core;

public sealed class ViewRegistry
{
    private readonly ModuleRegistry _moduleRegistry;
    private readonly object _lock = new();
    private readonly Dictionary<int, ViewInstance> _views = [];
    private int _nextId = 1;

    public ViewRegistry(ModuleRegistry moduleRegistry)
    {
        _moduleRegistry = moduleRegistry;
    }

    public int CreateView(int moduleIndex)
    {
        lock (_lock)
        {
            var module = _moduleRegistry.GetModule(moduleIndex);
            var registration = _moduleRegistry.GetDefinition(moduleIndex).ViewRegistration
                ?? throw new InvalidOperationException($"Module at index {moduleIndex} does not define a view.");

            var id = _nextId++;
            var view = registration.Factory();
            view.AppContext = module.AppContext!;
            view.ViewId = id;
            view.EventEmitter = (name, data) => module.SendEvent(name, new { viewId = id, data });

            _views[id] = new ViewInstance
            {
                Id = id,
                ModuleIndex = moduleIndex,
                View = view,
                Registration = registration,
            };

            return id;
        }
    }

    internal ViewInstance GetView(int viewId)
    {
        lock (_lock)
        {
            if (!_views.TryGetValue(viewId, out var view))
                throw new KeyNotFoundException($"View id {viewId} was not found.");

            return view;
        }
    }

    public void UpdateProps(int viewId, ReadOnlySpan<byte> propsJson)
    {
        ViewInstance instance;
        lock (_lock)
        {
            instance = GetView(viewId);
        }

        using var document = JsonDocument.Parse(propsJson.ToArray());
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Expected JSON object for view props.", nameof(propsJson));

        foreach (var prop in document.RootElement.EnumerateObject())
        {
            var descriptor = instance.Registration.Definition.Props
                .FirstOrDefault(item => item.Name == prop.Name);
            if (descriptor is null)
                continue;

            var value = TypeConverter.Deserialize(
                System.Text.Encoding.UTF8.GetBytes(prop.Value.GetRawText()),
                descriptor.ValueType);
            descriptor.Setter(instance.View, value);
        }

        instance.Registration.Definition.OnViewDidUpdatePropsCallback?.Invoke(instance.View);
    }

    public void DestroyView(int viewId)
    {
        ViewInstance? instance;
        lock (_lock)
        {
            if (!_views.Remove(viewId, out instance))
                return;
        }

        instance.Registration.Definition.OnViewDestroysCallback?.Invoke(instance.View);
    }
}
