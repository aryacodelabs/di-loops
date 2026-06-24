namespace DiLoops.RoslynHost;

internal static class SelfTestRunner
{
    public static async Task<int> RunAsync(string[] args)
    {
        var projectPath = args.FirstOrDefault(arg => arg.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase));
        if (string.IsNullOrWhiteSpace(projectPath) || !File.Exists(projectPath))
        {
            Console.Error.WriteLine("Usage: RoslynHost --self-test <path-to-csproj>");
            return 1;
        }

        var scanner = new Scanning.DiRegistrationScanner();
        var result = await scanner.ScanAsync(new Protocol.ScanPayload
        {
            ProjectPath = Path.GetFullPath(projectPath),
        });

        Console.WriteLine($"registrations={result.Registrations.Count}");
        Console.WriteLine($"constructorDeps={result.ConstructorDeps.Count}");
        Console.WriteLine($"factoryDeps={result.FactoryDeps.Count}");
        Console.WriteLine($"errors={result.Errors.Count}");
        return result.Errors.Any(error => error.Fatal) ? 1 : 0;
    }
}