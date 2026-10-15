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

        string? serviceType = null;
        string? implementationType = null;

        if (symbol.TypeArguments.Length > 0)
        {
            serviceType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(0));
            implementationType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        }
        else
        {
            var typeOfArgs = invocation.ArgumentList.Arguments
                .Select(arg => arg.Expression)
                .OfType<TypeOfExpressionSyntax>()
                .ToList();

            if (typeOfArgs.Count > 0)
            {
                serviceType = GetFqNameFromTypeOf(typeOfArgs[0], semanticModel);
                if (typeOfArgs.Count > 1)
                {
                    implementationType = GetFqNameFromTypeOf(typeOfArgs[1], semanticModel);
                }
                else
                {
                    implementationType = serviceType;
                }
            }
        }

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

        string? serviceKey = null;
        string? serviceType = null;
        string? implementationType = null;

        if (symbol.TypeArguments.Length > 0)
        {
            var firstArgument = invocation.ArgumentList.Arguments.FirstOrDefault();
            if (firstArgument is null)
            {
                return;
            }

            serviceKey = ExtractServiceKey(firstArgument.Expression, semanticModel);
            serviceType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(0));
            implementationType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        }
        else
        {
            var firstArgument = invocation.ArgumentList.Arguments.FirstOrDefault();
            if (firstArgument?.Expression is TypeOfExpressionSyntax typeOfService)
            {
                serviceType = GetFqNameFromTypeOf(typeOfService, semanticModel);
                var keyArgument = invocation.ArgumentList.Arguments.ElementAtOrDefault(1);
                if (keyArgument is not null)
                {
                    serviceKey = ExtractServiceKey(keyArgument.Expression, semanticModel);
                }
                var implArgument = invocation.ArgumentList.Arguments.ElementAtOrDefault(2);
                if (implArgument?.Expression is TypeOfExpressionSyntax typeOfImpl)
                {
                    implementationType = GetFqNameFromTypeOf(typeOfImpl, semanticModel);
                }
                else
                {
                    implementationType = serviceType;
                }
            }
        }

        if (string.IsNullOrWhiteSpace(serviceKey) || string.IsNullOrWhiteSpace(serviceType))
        {
            return;
        }

        var lifetime = MapLifetime(methodName);
        var isTryAdd = methodName.StartsWith("TryAddKeyed", StringComparison.Ordinal);
        var isFactory = invocation.ArgumentList.Arguments
            .Skip(1)
            .Any(argument => argument.Expression is LambdaExpressionSyntax);

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
                var arity = 0;
                var cleanImplName = implName;
                if (implName.Contains('<'))
                {
                    var genericStart = implName.IndexOf('<');
                    var genericEnd = implName.LastIndexOf('>');
                    if (genericEnd > genericStart)
                    {
                        var inside = implName.Substring(genericStart + 1, genericEnd - genericStart - 1).Trim();
                        arity = inside.Length == 0 ? 1 : inside.Count(c => c == ',') + 1;
                        cleanImplName = implName.Substring(0, genericStart);
                    }
                }

                INamedTypeSymbol? symbol = null;
                if (arity > 0)
                {
                    symbol = compilation.GetTypeByMetadataName($"{cleanImplName}`{arity}")
                        ?? compilation.GlobalNamespace.GetNamespaceMembers()
                            .SelectMany(GetAllTypes)
                            .FirstOrDefault(type =>
                            {
                                var displayName = type.ToDisplayString();
                                var typeBase = displayName.Contains('<') ? displayName.Substring(0, displayName.IndexOf('<')) : displayName;
                                return (typeBase == cleanImplName || type.Name == cleanImplName) && type.Arity == arity;
                            });
                }
                else
                {
                    symbol = compilation.GetTypeByMetadataName(implName)
                        ?? compilation.GlobalNamespace.GetNamespaceMembers()
                            .SelectMany(GetAllTypes)
                            .FirstOrDefault(type => type.ToDisplayString() == implName);
                }

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

    private static string? GetFqName(ITypeSymbol? typeSymbol)
    {
        if (typeSymbol is null)
        {
            return null;
        }

        if (typeSymbol is INamedTypeSymbol namedType && namedType.IsGenericType)
        {
            if (namedType.IsUnboundGenericType || namedType.TypeArguments.All(t => t.TypeKind == TypeKind.TypeParameter))
            {
                var unbound = namedType.IsUnboundGenericType ? namedType : namedType.ConstructUnboundGenericType();
                return unbound.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)
                    .Replace("global::", string.Empty);
            }
        }

        return typeSymbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)
            .Replace("global::", string.Empty);
    }

    private static string? GetFqNameFromTypeOf(TypeOfExpressionSyntax typeOfExpr, SemanticModel semanticModel)
    {
        var typeSymbol = semanticModel.GetTypeInfo(typeOfExpr.Type).Type;
        if (typeSymbol is not null)
        {
            return GetFqName(typeSymbol);
        }

        var raw = typeOfExpr.Type.ToString().Trim();
        if (raw.StartsWith("global::", StringComparison.Ordinal))
        {
            raw = raw.Substring("global::".Length);
        }
        return NormalizeOpenGenericSyntax(raw);
    }

    private static string NormalizeOpenGenericSyntax(string typeName)
    {
        return System.Text.RegularExpressions.Regex.Replace(typeName, @"<\s*,*\s*>", m =>
        {
            var commaCount = m.Value.Count(c => c == ',');
            return "<" + new string(',', commaCount) + ">";
        });
    }

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

        string? serviceType = null;
        string? implementationType = null;

        var symbol = semanticModel.GetSymbolInfo(innerInvocation).Symbol as IMethodSymbol;
        if (symbol?.TypeArguments.Length > 0)
        {
            serviceType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(0));
            implementationType = GetFqName(symbol.TypeArguments.ElementAtOrDefault(1)) ?? serviceType;
        }
        else
        {
            var typeOfArgs = innerInvocation.ArgumentList.Arguments
                .Select(arg => arg.Expression)
                .OfType<TypeOfExpressionSyntax>()
                .ToList();

            if (typeOfArgs.Count > 0)
            {
                serviceType = GetFqNameFromTypeOf(typeOfArgs[0], semanticModel);
                implementationType = typeOfArgs.Count > 1
                    ? GetFqNameFromTypeOf(typeOfArgs[1], semanticModel)
                    : serviceType;
            }
        }

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