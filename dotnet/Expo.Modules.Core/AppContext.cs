namespace Expo.Modules.Core;

/// <summary>
/// Shared context available to all modules. Placeholder for future shared services
/// (file system access, permissions, etc.).
/// </summary>
public class AppContext
{
    public ModuleRegistry Registry { get; }

    internal AppContext(ModuleRegistry registry)
    {
        Registry = registry;
    }
}
