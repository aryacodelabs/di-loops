import { describe, expect, it } from 'vitest';
import { RegexExtensionMethodResolver } from '../../src/resolver/extensionMethodResolver';
import { findExtensionMethodCalls } from '../../src/resolver/extensionMethodPatterns';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';

const SCOPE = 'C:/projects/MyApp';

describe('findExtensionMethodCalls', () => {
  it('finds custom Add* calls but not AddSingleton/AddScoped', () => {
    const source = `
builder.Services.AddApplicationServices();
builder.Services.AddSingleton<IFoo, Foo>();
builder.Services.AddInfrastructure();
`;

    const calls = findExtensionMethodCalls(source).map((c) => c.methodName);
    expect(calls).toEqual(['AddApplicationServices', 'AddInfrastructure']);
  });
});

describe('RegexExtensionMethodResolver', () => {
  const files = {
    'C:/projects/MyApp/Program.cs': `
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddApplicationServices();
`,
    'C:/projects/MyApp/ServiceCollectionExtensions.cs': `
using Microsoft.Extensions.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static void AddApplicationServices(this IServiceCollection services)
    {
        services.AddSingleton<IFooService, FooService>();
        services.AddInfrastructure();
    }

    public static void AddInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<IBarService, BarService>();
    }
}
`,
  };

  it('follows extension methods and discovers nested registrations', async () => {
    const resolver = new RegexExtensionMethodResolver(new InMemoryScannerFileAccess(files));

    const resolved = await resolver.resolve(
      [],
      { fsPath: SCOPE, toString: () => SCOPE },
    );

    const serviceTypes = resolved.map((r) => r.serviceType).sort();
    expect(serviceTypes).toEqual(['IBarService', 'IFooService']);
  });

  it('merges with existing direct registrations without duplicates', async () => {
    const resolver = new RegexExtensionMethodResolver(new InMemoryScannerFileAccess(files));
    const existing = [
      {
        id: 'existing-foo',
        serviceType: 'IFooService',
        implementationType: 'FooService',
        lifetime: 'Singleton' as const,
        isTryAdd: false,
        isFactory: false,
        location: {
          fileUri: 'file:///program.cs',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
        },
      },
    ];

    const resolved = await resolver.resolve(existing, { fsPath: SCOPE, toString: () => SCOPE });
    expect(resolved.some((r) => r.serviceType === 'IBarService')).toBe(true);
    expect(resolved.filter((r) => r.serviceType === 'IFooService').length).toBeGreaterThanOrEqual(1);
  });
});