namespace DiLoops.RoslynHost.Protocol;

public sealed class RoslynRequest
{
    public int ProtocolVersion { get; set; }
    public string Id { get; set; } = string.Empty;
    public string Cmd { get; set; } = string.Empty;
    public System.Text.Json.JsonElement Payload { get; set; }
}

public sealed class RoslynResponse
{
    public int ProtocolVersion { get; set; } = 1;
    public string Id { get; set; } = string.Empty;
    public bool Ok { get; set; }
    public object? Payload { get; set; }
    public RoslynErrorDto? Error { get; set; }
}

public sealed class RoslynErrorDto
{
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public bool Fatal { get; set; }
}

public sealed class PingResult
{
    public string HostVersion { get; set; } = string.Empty;
    public string RoslynVersion { get; set; } = string.Empty;
    public string Rid { get; set; } = string.Empty;
}

public sealed class ScanPayload
{
    public string? SolutionPath { get; set; }
    public string? ProjectPath { get; set; }
    public string[]? ChangedFiles { get; set; }
    public bool IncludeServiceDescriptorReplace { get; set; } = true;
    public bool ExcludeTestProjects { get; set; } = true;
    public bool EnableKeyed { get; set; } = false;
}

public sealed class RegistrationDto
{
    public string ServiceTypeFqName { get; set; } = string.Empty;
    public string ImplementationTypeFqName { get; set; } = string.Empty;
    public string Lifetime { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int StartLine { get; set; }
    public int StartColumn { get; set; }
    public int EndLine { get; set; }
    public int EndColumn { get; set; }
    public bool IsTryAdd { get; set; }
    public bool IsFactory { get; set; }
    public string? Key { get; set; }
}

public sealed class ConstructorDepDto
{
    public string ImplFqName { get; set; } = string.Empty;
    public string ParamFqName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
}

public sealed class FactoryDepDto
{
    public string RegistrationFqName { get; set; } = string.Empty;
    public string ResolvedFqName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public int Line { get; set; }
}

public sealed class ScanResult
{
    public List<RegistrationDto> Registrations { get; set; } = [];
    public List<ConstructorDepDto> ConstructorDeps { get; set; } = [];
    public List<FactoryDepDto> FactoryDeps { get; set; } = [];
    public List<RoslynErrorDto> Errors { get; set; } = [];
}