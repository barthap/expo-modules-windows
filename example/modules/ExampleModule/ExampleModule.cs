using Expo.Modules.Core;

namespace ExampleModules;

public class ExampleModule : Module
{
    public override ModuleDefinition Definition() => new()
    {
        Name("ExampleModule"),

        Function<double, double, double>("multiply", (a, b) => a * b),

        Function<string, string>("greet", (name) => $"Hello, {name}! Welcome to Expo Modules on Windows."),

        AsyncFunction<double, double>("delayedSquare", async (x) =>
        {
            await Task.Delay(500);
            return x * x;
        }),

        Constants(new
        {
            platform = "windows",
            version = "0.1.0",
            isWindows = true
        }),

        Events("onStatusChange"),
    };
}
