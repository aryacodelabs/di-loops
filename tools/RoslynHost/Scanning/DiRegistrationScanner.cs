using System.Collections.Immutable;
using DiLoops.RoslynHost.Protocol;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;

namespace DiLoops.RoslynHost.Scanning;

public sealed class DiRegistrationScanner
{
    private static readonly string[] LifetimeMethodNames =
    [
        "AddSingleton",
        "AddScoped",
        "AddTransient",
        "TryAddSingleton",
        "TryAddScoped",
        "TryAddTransient",
    ];

    private static readonly string[] KeyedLifetimeMethodNames =
    [
        "AddKeyedSingleton",
        "AddKeyedScoped",
        "AddKeyedTransient",
        "TryAddKeyedSingleton",
        "TryAddKeyedScoped",
        "TryAddKeyedTransient",
    ];

    public async Task<ScanResult> ScanAsync(ScanPayload payload)
    {
        var result = new ScanResult();
        using var workspace = MSBuildWorkspace.Create();

        Solution? solution = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(payload.SolutionPath) && File.Exists(payload.SolutionPath))
            {
                solution = await workspace.OpenSolutionAsync(payload.SolutionPath);
            }
            else if (!string.IsNullOrWhiteSpace(payload.ProjectPath) && File.Exists(payload.ProjectPath))
            {
                var project = await workspace.OpenProjectAsync(payload.ProjectPath);
                solution = project.Solution;
            }
            else
            {
                result.Errors.Add(new RoslynErrorDto
                {
                    Code = "PROJ_LOAD_FAILED",
                    Message = "Solution or project path not found",
                    Fatal = true,
                });
                return result;
            }
        }
        catch (Exception ex)
        {
            result.Errors.Add(new RoslynErrorDto
            {
                Code = "PROJ_LOAD_FAILED",
                Message = ex.Message,
                Fatal = true,
            });
            return result;
        }

        foreach (var diagnostic in workspace.Diagnostics)
        {
            if (diagnostic.Kind == WorkspaceDiagnosticKind.Failure)
            {
                result.Errors.Add(new RoslynErrorDto
                {
                    Code = "PROJ_LOAD_FAILED",
                    Message = diagnostic.Message,
                    Fatal = false,
                });
            }
        }

        var changedFiles = payload.ChangedFiles?
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var project in solution.Projects)
        {
            if (payload.ExcludeTestProjects && IsTestProjectPath(project.FilePath ?? project.Name))
            {
                continue;
            }

            var compilation = await project.GetCompilationAsync();
            if (compilation is null)
            {
                continue;
            }

            foreach (var document in project.Documents)
            {
                if (changedFiles is { Count: > 0 })
                {
                    var docPath = document.FilePath;
                    if (docPath is null || !changedFiles.Contains(Path.GetFullPath(docPath)))
                    {
                        continue;
                    }
                }

                if (payload.ExcludeTestProjects && document.FilePath is not null &&
                    IsTestProjectPath(document.FilePath))
                {
                    continue;
                }

                var root = await document.GetSyntaxRootAsync();
                var semanticModel = await document.GetSemanticModelAsync();
                if (root is null || semanticModel is null || document.FilePath is null)
                {
                    continue;
                }

                ScanDocument(root, semanticModel, document.FilePath, payload, result);
            }
        }

        ExtractConstructorDependencies(solution, result);
        return result;
    }

    private static void ScanDocument(
        SyntaxNode root,
        SemanticModel semanticModel,
        string filePath,
        ScanPayload payload,
        ScanResult result)
    {
        var invocations = root.DescendantNodes().OfType<InvocationExpressionSyntax>();
        foreach (var invocation in invocations)
        {
            if (invocation.Expression is not MemberAccessExpressionSyntax memberAccess)
            {
                continue;
            }

            var methodName = memberAccess.Name.Identifier.Text;
            if (methodName == "Replace" && payload.IncludeServiceDescriptorReplace)
            {
                TryAddServiceDescriptorReplace(invocation, semanticModel, filePath, result);
                continue;
            }

            if (KeyedLifetimeMethodNames.Contains(methodName))
            {
                if (!payload.EnableKeyed)
                {
                    continue;
                }

                TryAddKeyedRegistration(invocation, semanticModel, filePath, methodName, result);
                continue;
            }

            if (!LifetimeMethodNames.Contains(methodName))
            {
                continue;
            }

            TryAddStandardRegistration(invocation, semanticModel, filePath, methodName, result);
        }
    }

    private static void TryAddStandardRegistration(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        string filePath,
        string methodName,
        ScanResult result)
    {
        var symbol = semanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
        if (symbol is null)
        {
            return;
        }

        var lifetime = MapLifetime(methodName);
        var isTryAdd = methodName.StartsWith("TryAdd", StringComparison.Ordinal);
        var isFactory = invocation.ArgumentList.Arguments.Count > 0 &&
            invocation.ArgumentList.Arguments[0].Expression is LambdaExpressionSyntax;

        var serviceType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(0));
        var implementationType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        if (string.IsNullOrWhiteSpace(serviceType))
        {
            return;
        }

        var span = invocation.GetLocation().GetLineSpan();
        var registration = new RegistrationDto
        {
            ServiceTypeFqName = serviceType,
            ImplementationTypeFqName = implementationType ?? serviceType,
            Lifetime = lifetime,
            FilePath = filePath,
            StartLine = span.StartLinePosition.Line,
            StartColumn = span.StartLinePosition.Character,
            EndLine = span.EndLinePosition.Line,
            EndColumn = span.EndLinePosition.Character,
            IsTryAdd = isTryAdd,
            IsFactory = isFactory,
        };

        result.Registrations.Add(registration);

        if (isFactory)
        {
            ExtractFactoryDependencies(invocation, semanticModel, filePath, registration, result);
        }
    }

    private static void TryAddKeyedRegistration(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        string filePath,
        string methodName,
        ScanResult result)
    {
        var symbol = semanticModel.GetSymbolInfo(invocation).Symbol as IMethodSymbol;
        if (symbol is null)
        {
            return;
        }

        var firstArgument = invocation.ArgumentList.Arguments.FirstOrDefault();
        if (firstArgument is null)
        {
            return;
        }

        var serviceKey = ExtractServiceKey(firstArgument.Expression, semanticModel);
        if (string.IsNullOrWhiteSpace(serviceKey))
        {
            return;
        }

        var lifetime = MapLifetime(methodName);
        var isTryAdd = methodName.StartsWith("TryAddKeyed", StringComparison.Ordinal);
        var isFactory = invocation.ArgumentList.Arguments
            .Skip(1)
            .Any(argument => argument.Expression is LambdaExpressionSyntax);

        var serviceType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(0));
        var implementationType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        if (string.IsNullOrWhiteSpace(serviceType))
        {
            return;
        }

        var span = invocation.GetLocation().GetLineSpan();
        var registration = new RegistrationDto
        {
            ServiceTypeFqName = serviceType,
            ImplementationTypeFqName = implementationType ?? serviceType,
            Lifetime = lifetime,
            FilePath = filePath,
            StartLine = span.StartLinePosition.Line,
            StartColumn = span.StartLinePosition.Character,
            EndLine = span.EndLinePosition.Line,
            EndColumn = span.EndLinePosition.Character,
            IsTryAdd = isTryAdd,
            IsFactory = isFactory,
            Key = serviceKey,
        };

        result.Registrations.Add(registration);

        if (isFactory)
        {
            ExtractFactoryDependencies(invocation, semanticModel, filePath, registration, result);
        }
    }

    private static string? ExtractServiceKey(ExpressionSyntax expression, SemanticModel semanticModel)
    {
        if (expression is LiteralExpressionSyntax literal)
        {
            return literal.Token.ValueText;
        }

        var constant = semanticModel.GetConstantValue(expression);
        if (constant.HasValue && constant.Value is not null)
        {
            return constant.Value.ToString();
        }

        var source = expression.ToString().Trim();
        return string.IsNullOrWhiteSpace(source) ? null : source;
    }

    private static void ExtractFactoryDependencies(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        string filePath,
        RegistrationDto registration,
        ScanResult result)
    {
        var lambda = invocation.ArgumentList.Arguments
            .Select(arg => arg.Expression)
            .OfType<LambdaExpressionSyntax>()
            .FirstOrDefault();

        if (lambda is null)
        {
            return;
        }

        foreach (var nestedInvocation in lambda.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (nestedInvocation.Expression is not MemberAccessExpressionSyntax memberAccess)
            {
                continue;
            }

            var name = memberAccess.Name.Identifier.Text;
            if (name is not ("GetRequiredService" or "GetService"))
            {
                continue;
            }

            var symbol = semanticModel.GetSymbolInfo(nestedInvocation).Symbol as IMethodSymbol;
            var resolved = GetFqName(symbol?.TypeArguments.ElementAtOrDefault(0));
            if (string.IsNullOrWhiteSpace(resolved))
            {
                continue;
            }

            var line = nestedInvocation.GetLocation().GetLineSpan().StartLinePosition.Line;
            result.FactoryDeps.Add(new FactoryDepDto
            {
                RegistrationFqName = registration.ImplementationTypeFqName,
                ResolvedFqName = resolved,
                FilePath = filePath,
                Line = line,
            });
        }
    }

    private static void ExtractConstructorDependencies(Solution solution, ScanResult result)
    {
        var implementationTypes = result.Registrations
            .Select(registration => registration.ImplementationTypeFqName)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var project in solution.Projects)
        {
            var compilation = project.GetCompilationAsync().GetAwaiter().GetResult();
            if (compilation is null)
            {
                continue;
            }

            foreach (var implName in implementationTypes)
            {
                var symbol = compilation.GetTypeByMetadataName(implName)
                    ?? compilation.GlobalNamespace.GetNamespaceMembers()
                        .SelectMany(GetAllTypes)
                        .FirstOrDefault(type => type.ToDisplayString() == implName);

                if (symbol is not INamedTypeSymbol namedType)
                {
                    continue;
                }

                var ctor = namedType.InstanceConstructors
                    .Where(constructor => constructor.DeclaredAccessibility == Accessibility.Public)
                    .OrderByDescending(constructor => constructor.Parameters.Length)
                    .FirstOrDefault();

                if (ctor is null)
                {
                    continue;
                }

                foreach (var parameter in ctor.Parameters)
                {
                    var paramType = GetFqName(parameter.Type);
                    if (string.IsNullOrWhiteSpace(paramType))
                    {
                        continue;
                    }

                    var location = ctor.Locations.FirstOrDefault();
                    var filePath = location?.SourceTree?.FilePath ?? string.Empty;
                    var line = location?.GetLineSpan().StartLinePosition.Line ?? 0;

                    result.ConstructorDeps.Add(new ConstructorDepDto
                    {
                        ImplFqName = implName,
                        ParamFqName = paramType,
                        FilePath = filePath,
                        Line = line,
                    });
                }
            }
        }
    }

    private static IEnumerable<INamedTypeSymbol> GetAllTypes(INamespaceSymbol namespaceSymbol)
    {
        foreach (var type in namespaceSymbol.GetTypeMembers())
        {
            yield return type;
        }

        foreach (var nested in namespaceSymbol.GetNamespaceMembers())
        {
            foreach (var type in GetAllTypes(nested))
            {
                yield return type;
            }
        }
    }

    private static string MapLifetime(string methodName) =>
        methodName switch
        {
            var name when name.Contains("Singleton", StringComparison.Ordinal) => "Singleton",
            var name when name.Contains("Scoped", StringComparison.Ordinal) => "Scoped",
            _ => "Transient",
        };

    private static string? GetFqName(ITypeSymbol? typeSymbol) =>
        typeSymbol?.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)
            .Replace("global::", string.Empty);

    private static void TryAddServiceDescriptorReplace(
        InvocationExpressionSyntax invocation,
        SemanticModel semanticModel,
        string filePath,
        ScanResult result)
    {
        var argument = invocation.ArgumentList.Arguments.FirstOrDefault()?.Expression;
        if (argument is not InvocationExpressionSyntax innerInvocation)
        {
            return;
        }

        if (innerInvocation.Expression is not MemberAccessExpressionSyntax sdAccess)
        {
            return;
        }

        if (sdAccess.Expression.ToString() != "ServiceDescriptor")
        {
            return;
        }

        var lifetimeName = sdAccess.Name.Identifier.Text;
        if (lifetimeName is not ("Singleton" or "Scoped" or "Transient"))
        {
            return;
        }

        var symbol = semanticModel.GetSymbolInfo(innerInvocation).Symbol as IMethodSymbol;
        var serviceType = GetFqName(symbol?.TypeArguments.ElementAtOrDefault(0));
        var implementationType = GetFqName(symbol?.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        if (string.IsNullOrWhiteSpace(serviceType))
        {
            return;
        }

        var span = invocation.GetLocation().GetLineSpan();
        result.Registrations.Add(new RegistrationDto
        {
            ServiceTypeFqName = serviceType,
            ImplementationTypeFqName = implementationType ?? serviceType,
            Lifetime = lifetimeName,
            FilePath = filePath,
            StartLine = span.StartLinePosition.Line,
            StartColumn = span.StartLinePosition.Character,
            EndLine = span.EndLinePosition.Line,
            EndColumn = span.EndLinePosition.Character,
            IsTryAdd = false,
            IsFactory = false,
        });
    }

    private static bool IsTestProjectPath(string pathValue)
    {
        var name = Path.GetFileName(pathValue.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .ToLowerInvariant();
        if (name.EndsWith(".csproj", StringComparison.Ordinal))
        {
            name = name[..^7];
        }

        return name.Contains("unittest", StringComparison.Ordinal)
            || name.EndsWith(".tests", StringComparison.Ordinal)
            || name.EndsWith(".test", StringComparison.Ordinal)
            || (name.EndsWith("tests", StringComparison.Ordinal) && name != "tests");
    }
}