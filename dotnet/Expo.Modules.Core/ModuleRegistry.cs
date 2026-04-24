using Expo.Modules.Core.Exceptions;

namespace Expo.Modules.Core;

/// <summary>
/// Central registry that instantiates and manages all Expo modules.
/// Thread-safe via locking.
/// </summary>
public class ModuleRegistry
{
    private readonly Type[] _moduleTypes;
    private readonly object _lock = new();

    private Module[] _modules = [];
    private ModuleDefinition[] _definitions = [];
    private Dictionary<string, int> _nameToIndex = new();
    private AppContext? _appContext;

    public int ModuleCount => _modules.Length;

    public ModuleRegistry(Type[] moduleTypes)
    {
        _moduleTypes = moduleTypes;
    }

    public void Initialize()
    {
        lock (_lock)
        {
            _appContext = new AppContext(this);

            _modules = new Module[_moduleTypes.Length];
            _definitions = new ModuleDefinition[_moduleTypes.Length];
            _nameToIndex = new Dictionary<string, int>();

            for (int i = 0; i < _moduleTypes.Length; i++)
            {
                var module = (Module)Activator.CreateInstance(_moduleTypes[i])!;
                module.AppContext = _appContext;
                _modules[i] = module;

                var definition = module.Definition();
                _definitions[i] = definition;

                var name = definition.ModuleName ?? _moduleTypes[i].Name;
                _nameToIndex[name] = i;
            }

            // Run OnCreate callbacks
            foreach (var def in _definitions)
            {
                def.OnCreateCallback?.Invoke();
            }
        }
    }

    public void Destroy()
    {
        lock (_lock)
        {
            foreach (var def in _definitions)
            {
                def.OnDestroyCallback?.Invoke();
            }
        }
    }

    public Module GetModule(int index)
    {
        lock (_lock)
        {
            if (index < 0 || index >= _modules.Length)
                throw new ModuleNotFoundException($"index:{index}");
            return _modules[index];
        }
    }

    public Module GetModule(string name)
    {
        lock (_lock)
        {
            if (!_nameToIndex.TryGetValue(name, out var index))
                throw new ModuleNotFoundException(name);
            return _modules[index];
        }
    }

    public ModuleDefinition GetDefinition(int index)
    {
        lock (_lock)
        {
            if (index < 0 || index >= _definitions.Length)
                throw new ModuleNotFoundException($"index:{index}");
            return _definitions[index];
        }
    }

    public ModuleDefinition GetDefinition(string name)
    {
        lock (_lock)
        {
            if (!_nameToIndex.TryGetValue(name, out var index))
                throw new ModuleNotFoundException(name);
            return _definitions[index];
        }
    }

    /// <summary>
    /// Returns a JSON-serializable manifest of all module definitions.
    /// Used by Expo_GetModuleDefinitions to send metadata to C++/JS.
    /// </summary>
    public object GetManifest()
    {
        lock (_lock)
        {
            var modules = new List<object>();
            for (int i = 0; i < _definitions.Length; i++)
            {
                var def = _definitions[i];
                modules.Add(new
                {
                    name = def.ModuleName ?? _moduleTypes[i].Name,
                    syncFunctions = def.SyncFunctions.Keys.ToArray(),
                    asyncFunctions = def.AsyncFunctions.Keys.ToArray(),
                    constants = def.ConstantsMap,
                    events = def.EventNames.ToArray(),
                });
            }
            return modules;
        }
    }
}
