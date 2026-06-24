import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScanPipeline } from '../../src/index/scanPipeline';
import { createScanPipelineDeps } from '../../src/index/pipelineFactory';
import { createScanOptions } from '../../src/scanOptions';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';
import { getFixtureRoot, loadCsFilesFromDirectory } from '../helpers/fixtureLoader';

const FIXTURE_ROOT = getFixtureRoot('DiMapper.Sample');
const SCOPE = { fsPath: FIXTURE_ROOT, toString: () => FIXTURE_ROOT };

describe('unregistered dependency detection when registration removed', () => {
  it('flags consumers after a dependency registration is commented out of Program.cs', async () => {
    const files = loadCsFilesFromDirectory(FIXTURE_ROOT);
    const programPath = path.join(FIXTURE_ROOT, 'Program.cs').replace(/\\/g, '/');
    const deps = createScanPipelineDeps(new InMemoryScannerFileAccess(files));

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
      full.graph.registrations.some((registration) => registration.serviceType === 'IOrderRepository'),
    ).toBe(true);

    const commentedProgram = files[programPath].replace(
      'builder.Services.AddScoped<IOrderRepository, OrderRepository>();',
      '//builder.Services.AddScoped<IOrderRepository, OrderRepository>();',
    );

    const incrementalFiles = { ...files, [programPath]: commentedProgram };
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

    const unregistered = incremental.graph.issues.filter(
      (issue) => issue.kind === 'UNREGISTERED' && issue.relatedType === 'IOrderRepository',
    );
    expect(unregistered.length).toBeGreaterThanOrEqual(1);
    expect(
      incremental.graph.registrations.some((registration) => registration.serviceType === 'IOrderRepository'),
    ).toBe(false);
  });
});