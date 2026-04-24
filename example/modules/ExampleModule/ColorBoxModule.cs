using Expo.Modules.Core;
using Microsoft.UI.Composition;
using System.Numerics;
using Windows.UI;

namespace ExampleModules;

public sealed class ColorBoxModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("ColorBox"),
        View<ColorBoxView>()
            .Prop<string>("color", (view, color) => view.Color = color)
            .OnViewDidUpdateProps(view => view.CommitProps()),
    };
}

public sealed class ColorBoxView : ExpoView
{
    private SpriteVisual? _visual;
    private CompositionColorBrush? _brush;

    public string? Color { get; set; }

    public void CommitProps()
    {
        if (_brush is not null)
        {
            _brush.Color = ParseColor(Color);
        }
    }

    protected override Visual? CreateCompositionVisual(Compositor compositor)
    {
        _brush = compositor.CreateColorBrush(ParseColor(Color));
        _visual = compositor.CreateSpriteVisual();
        _visual.Brush = _brush;
        return _visual;
    }

    protected override void OnLayout(float width, float height)
    {
        if (_visual is not null)
        {
            _visual.Size = new Vector2(width, height);
        }
    }

    private static Windows.UI.Color ParseColor(string? value)
    {
        return value?.ToLowerInvariant() switch
        {
            "red" => MakeColor(0xFF, 0xCD, 0x5C, 0x5C),
            "green" => MakeColor(0xFF, 0x2E, 0x8B, 0x57),
            "orange" => MakeColor(0xFF, 0xFF, 0x8C, 0x00),
            "purple" => MakeColor(0xFF, 0x93, 0x70, 0xDB),
            _ => MakeColor(0xFF, 0x46, 0x82, 0xB4),
        };
    }

    private static Windows.UI.Color MakeColor(byte a, byte r, byte g, byte b)
    {
        return Windows.UI.Color.FromArgb(a, r, g, b);
    }
}
