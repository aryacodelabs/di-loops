import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScanPipeline } from '../../src/index/scanPipeline';
import { createScanPipelineDeps } from '../../src/index/pipelineFactory';
import { createScanOptions } from '../../src/scanOptions';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';
import { getFixtureRoot, loadCsFilesFromDirectory } from '../helpers/fixtureLoader';

const FIXTURE_ROOT = getFixtureRoot('DiMapper.Sample');
const SCOPE = { fsPath: FIXTURE_ROOT, toString: () => FIXTURE_ROOT };

const HOME_CONTROLLER = `using DiMapper.Sample.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiMapper.Sample.Controllers;

public class HomeController : Controller
{
    private readonly IErrorLogging _errorLogging;

    public HomeController(IErrorLogging errorLogging)
    {
        _errorLogging = errorLogging;
    }
}
`;

const CLAUSE_CONTROLLER = `using DiMapper.Sample.Services;
using Microsoft.AspNetCore.Mvc;

namespace DiMapper.Sample.Controllers;

public class ClauseController : Controller
{
    public ClauseController(IErrorLogging errorLogging)
    {
    }
}
`;

const ERROR_LOGGING_INTERFACE = `namespace DiMapper.Sample.Services;

public interface IErrorLogging
{
    void Log(string message);
}
`;

const ERROR_LOGGING_IMPL = `namespace DiMapper.Sample.Services;

public class ErrorLogging : IErrorLogging
{
    public void Log(string message)
    {
    }
}
`;

describe('injection site detection for controllers', () => {
  it('flags controller ctor params when IErrorLogging registration is commented out', async () => {
    const files = loadCsFilesFromDirectory(FIXTURE_ROOT);
    const programPath = path.join(FIXTURE_ROOT, 'Program.cs').replace(/\\/g, '/');
    const homePath = path.join(FIXTURE_ROOT, 'Controllers/HomeController.cs').replace(/\\/g, '/');
    const clausePath = path.join(FIXTURE_ROOT, 'Controllers/ClauseController.cs').replace(/\\/g, '/');
    const interfacePath = path.join(FIXTURE_ROOT, 'Services/IErrorLogging.cs').replace(/\\/g, '/');
    const implPath = path.join(FIXTURE_ROOT, 'Services/ErrorLogging.cs').replace(/\\/g, '/');

    const programWithRegistration = `${files[programPath]}
builder.Services.AddScoped<IErrorLogging, ErrorLogging>();
`;

    const allFiles = {
      ...files,
      [programPath]: programWithRegistration,
      [homePath]: HOME_CONTROLLER,
      [clausePath]: CLAUSE_CONTROLLER,
      [interfacePath]: ERROR_LOGGING_INTERFACE,
      [implPath]: ERROR_LOGGING_IMPL,
    };

    const deps = createScanPipelineDeps(new InMemoryScannerFileAccess(allFiles));
    const full = await runScanPipeline(
      {
        mode: 'full',
        scopeRoot: SCOPE,
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      deps,
    );

    expect(
      full.graph.registrations.some((registration) => registration.serviceType === 'IErrorLogging'),
    ).toBe(true);
    expect(
      full.graph.issues.filter((issue) => issue.code === 'UNREGISTERED_INJECTION'),
    ).toHaveLength(0);

    const commentedProgram = programWithRegistration.replace(
      'builder.Services.AddScoped<IErrorLogging, ErrorLogging>();',
      '//builder.Services.AddScoped<IErrorLogging, ErrorLogging>();',
    );

    const incrementalFiles = { ...allFiles, [programPath]: commentedProgram };
    const incremental = await runScanPipeline(
      {
        mode: 'incremental',
        scopeRoot: SCOPE,
        changedFiles: [{ fsPath: programPath, toString: () => programPath }],
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      createScanPipelineDeps(new InMemoryScannerFileAccess(incrementalFiles)),
      {
        existingRegistrations: full.graph.registrations,
        readFile: async (uri) => incrementalFiles[uri.fsPath.replace(/\\/g, '/')] ?? '',
      },
    );

    const injectionIssues = incremental.graph.issues.filter(
      (issue) => issue.code === 'UNREGISTERED_INJECTION' && issue.relatedType === 'IErrorLogging',
    );

    expect(injectionIssues.length).toBeGreaterThanOrEqual(2);
    expect(
      injectionIssues.some((issue) => issue.location.fileUri.includes('HomeController.cs')),
    ).toBe(true);
    expect(
      injectionIssues.some((issue) => issue.location.fileUri.includes('ClauseController.cs')),
    ).toBe(true);
    expect(
      incremental.graph.registrations.some((registration) => registration.serviceType === 'IErrorLogging'),
    ).toBe(false);
  });
});