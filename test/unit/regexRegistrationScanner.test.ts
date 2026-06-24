import { describe, expect, it } from 'vitest';
import { parseRegistrationsFromText } from '../../src/scanner/regexRegistrationScanner';

const SCOPE = 'C:/projects/MyApp';
const FILE = 'file:///c:/projects/MyApp/Program.cs';

const SAMPLE = `
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IFooService, FooService>();
builder.Services.AddScoped<FooService>();
builder.Services.TryAddTransient<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<IReportService>(sp => new ReportService());
`;

describe('parseRegistrationsFromText', () => {
  it('parses standard, concrete-only, TryAdd, and factory registrations', () => {
    const registrations = parseRegistrationsFromText(SAMPLE, FILE, SCOPE);

    expect(registrations).toHaveLength(4);

    expect(registrations[0]).toMatchObject({
      serviceType: 'IFooService',
      implementationType: 'FooService',
      lifetime: 'Singleton',
      isTryAdd: false,
      isFactory: false,
    });

    expect(registrations[1]).toMatchObject({
      serviceType: 'FooService',
      implementationType: 'FooService',
      lifetime: 'Scoped',
      isTryAdd: false,
      isFactory: false,
    });

    expect(registrations[2]).toMatchObject({
      serviceType: 'IEmailSender',
      implementationType: 'SmtpEmailSender',
      lifetime: 'Transient',
      isTryAdd: true,
      isFactory: false,
    });

    expect(registrations[3]).toMatchObject({
      serviceType: 'IReportService',
      implementationType: 'ReportService',
      lifetime: 'Singleton',
      isTryAdd: false,
      isFactory: true,
    });
  });

  it('assigns stable logical ids and source locations', () => {
    const first = parseRegistrationsFromText(SAMPLE, FILE, SCOPE);
    const second = parseRegistrationsFromText(SAMPLE, FILE, SCOPE);

    expect(first[0].id).toBe(second[0].id);
    expect(first[0].location.fileUri).toBe(FILE);
    expect(first[0].location.range.startLine).toBeGreaterThanOrEqual(0);
    expect(first[0].location.lineText).toContain('AddSingleton');
  });

  it('parses namespaced types', () => {
    const source = 'services.AddSingleton<MyApp.Services.IOrderService, MyApp.Services.OrderService>();';
    const registrations = parseRegistrationsFromText(source, FILE, SCOPE);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].serviceType).toBe('MyApp.Services.IOrderService');
    expect(registrations[0].implementationType).toBe('MyApp.Services.OrderService');
  });

  it('parses instance-arg, lambda factory, and ServiceDescriptor.Replace registrations', () => {
    const source = `
builder.Services.AddSingleton<IConfiguration>(configuration);
builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri("https://localhost") });
builder.Services.Replace(ServiceDescriptor.Scoped<IJsonSerializer, ZijiJsonSerializer>());
builder.Services.AddSingleton<ILogger>(s => s.GetRequiredService<ILoggerFactory>().CreateLogger("App"));
builder.Services.AddSingleton<IDbManager, DbManager>(p => new DbManager(p.GetRequiredService<AzureFunctionManager>()));
`;

    const registrations = parseRegistrationsFromText(source, FILE, SCOPE);
    const byService = Object.fromEntries(registrations.map((r) => [r.serviceType, r]));

    expect(byService.IConfiguration).toMatchObject({
      lifetime: 'Singleton',
      isFactory: false,
    });
    expect(byService.HttpClient).toMatchObject({
      lifetime: 'Scoped',
      implementationType: 'HttpClient',
      isFactory: true,
    });
    expect(byService.IJsonSerializer).toMatchObject({
      lifetime: 'Scoped',
      implementationType: 'ZijiJsonSerializer',
      isFactory: false,
    });
    expect(byService.ILogger).toMatchObject({
      lifetime: 'Singleton',
      isFactory: true,
    });
    expect(byService.IDbManager).toMatchObject({
      implementationType: 'DbManager',
      isFactory: true,
    });
  });

  it('parses keyed registrations when enableKeyed is true', () => {
    const source = `
builder.Services.AddKeyedSingleton<ICache, RedisCache>("primary");
builder.Services.TryAddKeyedScoped<ICache, MemoryCache>("secondary");
builder.Services.AddKeyedSingleton<IReportService>("legacy", (sp, key) => new ReportService());
`;

    const registrations = parseRegistrationsFromText(source, FILE, SCOPE, { enableKeyed: true });
    const byKey = Object.fromEntries(
      registrations.filter((r) => r.key).map((r) => [r.key!, r]),
    );

    expect(registrations.filter((r) => r.key).length).toBe(3);
    expect(byKey.primary).toMatchObject({
      serviceType: 'ICache',
      implementationType: 'RedisCache',
      lifetime: 'Singleton',
      isTryAdd: false,
    });
    expect(byKey.secondary).toMatchObject({
      lifetime: 'Scoped',
      isTryAdd: true,
    });
    expect(byKey.legacy).toMatchObject({
      serviceType: 'IReportService',
      isFactory: true,
    });
  });

  it('skips keyed registrations when enableKeyed is false', () => {
    const source = 'builder.Services.AddKeyedSingleton<ICache, RedisCache>("primary");';
    const registrations = parseRegistrationsFromText(source, FILE, SCOPE, { enableKeyed: false });
    expect(registrations).toHaveLength(0);
  });

  it('skips ServiceDescriptor.Replace when includeServiceDescriptorReplace is false', () => {
    const source = `
builder.Services.AddSingleton<IFoo, Foo>();
builder.Services.Replace(ServiceDescriptor.Scoped<IJsonSerializer, ZijiJsonSerializer>());
`;

    const registrations = parseRegistrationsFromText(source, FILE, SCOPE, {
      includeServiceDescriptorReplace: false,
    });

    expect(registrations.map((r) => r.serviceType)).toEqual(['IFoo']);
  });

  it('skips registrations in line comments', () => {
    const source = `
builder.Services.AddScoped<WsDataState>();
//builder.Services.AddScoped<QbDataState>();
builder.Services.AddScoped<IStoreHandler, LiveHandler>();
// builder.Services.AddSingleton<IStoreHandler, DeadHandler>();
`;

    const registrations = parseRegistrationsFromText(source, FILE, SCOPE);
    expect(registrations.map((r) => r.serviceType)).toEqual(['WsDataState', 'IStoreHandler']);
  });
});