using System.Text.Json;
using System.Text.Json.Serialization;
using DiLoops.RoslynHost.Protocol;
using DiLoops.RoslynHost.Scanning;
using Microsoft.Build.Locator;

if (args.Contains("--self-test"))
{
    Environment.Exit(await DiLoops.RoslynHost.SelfTestRunner.RunAsync(args));
}

MSBuildLocator.RegisterDefaults();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};

var scanner = new DiRegistrationScanner();
await using var transport = new NdjsonTransport(Console.In, Console.Out, jsonOptions);

while (true)
{
    var request = await transport.ReadRequestAsync();
    if (request is null)
    {
        break;
    }

    var response = await HandleRequestAsync(request, scanner);
    await transport.WriteResponseAsync(response);

    if (request.Cmd == "shutdown")
    {
        break;
    }
}

static async Task<RoslynResponse> HandleRequestAsync(RoslynRequest request, DiRegistrationScanner scanner)
{
    try
    {
        return request.Cmd switch
        {
            "ping" => CreateOk(request.Id, new PingResult
            {
                HostVersion = "0.2.0",
                RoslynVersion = typeof(Microsoft.CodeAnalysis.CSharp.CSharpCompilation).Assembly.GetName().Version?.ToString() ?? "unknown",
                Rid = System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier,
            }),
            "scan" => await HandleScanAsync(request, scanner),
            "shutdown" => CreateOk(request.Id, new Dictionary<string, object>()),
            _ => CreateError(request.Id, "UNKNOWN_CMD", $"Unknown command: {request.Cmd}", fatal: true),
        };
    }
    catch (Exception ex)
    {
        return CreateError(request.Id, "HOST_ERROR", ex.Message, fatal: true);
    }
}

static async Task<RoslynResponse> HandleScanAsync(RoslynRequest request, DiRegistrationScanner scanner)
{
    var payload = JsonSerializer.Deserialize<ScanPayload>(request.Payload.GetRawText(), new JsonSerializerOptions
    {
        PropertyNameCaseInsensitive = true,
    });

    if (payload is null || (string.IsNullOrWhiteSpace(payload.SolutionPath) && string.IsNullOrWhiteSpace(payload.ProjectPath)))
    {
        return CreateError(request.Id, "INVALID_PAYLOAD", "scan requires solutionPath or projectPath", fatal: true);
    }

    var result = await scanner.ScanAsync(payload);
    if (result.Errors.Any(error => error.Fatal))
    {
        return new RoslynResponse
        {
            ProtocolVersion = 1,
            Id = request.Id,
            Ok = false,
            Error = result.Errors.First(error => error.Fatal),
        };
    }

    return CreateOk(request.Id, result);
}

static RoslynResponse CreateOk(string id, object payload) => new()
{
    ProtocolVersion = 1,
    Id = id,
    Ok = true,
    Payload = payload,
};

static RoslynResponse CreateError(string id, string code, string message, bool fatal) => new()
{
    ProtocolVersion = 1,
    Id = id,
    Ok = false,
    Error = new RoslynErrorDto
    {
        Code = code,
        Message = message,
        Fatal = fatal,
    },
};