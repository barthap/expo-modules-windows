using System.Numerics;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml.Controls;
using WinRT;

namespace Expo.Modules.Core;

/// <summary>
/// Base class for Expo native views on Windows.
/// </summary>
public abstract class ExpoView : UserControl
{
    public AppContext AppContext { get; internal set; } = null!;
    public int ViewId { get; internal set; }
    public Compositor? Compositor { get; private set; }
    public Visual? CompositionVisual { get; private set; }

    internal Action<string, object?>? EventEmitter { get; set; }

    protected void SendEvent(string name, object? data = null)
    {
        EventEmitter?.Invoke(name, data);
    }

    /// <summary>
    /// Creates the composition visual hosted by React Native Windows Fabric.
    /// XAML control-tree hosting is intentionally deferred until WinUI ContentIsland
    /// support can attach a real XamlRoot for managed controls.
    /// </summary>
    protected virtual Visual? CreateCompositionVisual(Compositor compositor)
    {
        return null;
    }

    protected virtual void OnLayout(float width, float height)
    {
        if (CompositionVisual is not null)
        {
            CompositionVisual.Size = new Vector2(width, height);
        }
    }

    internal nint InitializeComposition(nint compositorPtr)
    {
        Compositor = MarshalInterface<Compositor>.FromAbi(compositorPtr);
        CompositionVisual = CreateCompositionVisual(Compositor);
        return CompositionVisual is null
            ? 0
            : MarshalInspectable<object>.FromManaged(CompositionVisual);
    }

    internal void UpdateLayout(float width, float height)
    {
        OnLayout(width, height);
    }
}
