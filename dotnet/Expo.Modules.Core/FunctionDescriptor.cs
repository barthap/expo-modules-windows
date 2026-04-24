namespace Expo.Modules.Core;

public class FunctionDescriptor
{
    public string Name { get; }
    public Delegate Delegate { get; }
    public Type[] ParameterTypes { get; }
    public Type ReturnType { get; }
    public bool IsAsync { get; }

    public FunctionDescriptor(string name, Delegate del, bool isAsync = false)
    {
        Name = name;
        Delegate = del;
        IsAsync = isAsync;

        var method = del.Method;
        ParameterTypes = method.GetParameters().Select(p => p.ParameterType).ToArray();
        ReturnType = method.ReturnType;
    }

    public object? Invoke(object?[] args)
    {
        var converted = ConvertArgs(args);
        return Delegate.DynamicInvoke(converted);
    }

    public async Task<object?> InvokeAsync(object?[] args)
    {
        var converted = ConvertArgs(args);
        var result = Delegate.DynamicInvoke(converted);

        if (result is Task task)
        {
            await task.ConfigureAwait(false);

            // Extract result from Task<T>
            var taskType = task.GetType();
            if (taskType.IsGenericType)
            {
                var resultProp = taskType.GetProperty("Result");
                return resultProp?.GetValue(task);
            }

            return null; // Task (non-generic) — void async
        }

        return result;
    }

    private object?[] ConvertArgs(object?[] args)
    {
        if (args.Length != ParameterTypes.Length)
            throw new Exceptions.InvalidArgsException(
                $"Function '{Name}' expects {ParameterTypes.Length} arguments but received {args.Length}.");

        var converted = new object?[args.Length];
        for (int i = 0; i < args.Length; i++)
        {
            converted[i] = TypeConverter.ConvertArg(args[i], ParameterTypes[i]);
        }
        return converted;
    }
}
