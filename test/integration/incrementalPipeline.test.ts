import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScanPipeline } from '../../src/index/scanPipeline';
import { createScanPipelineDeps } from '../../src/index/pipelineFactory';
import { createScanOptions } from '../../src/scanOptions';
import { mergeRegistrations } from '../../src/index/diIndexCache';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';
import { getFixtureRoot, loadCsFilesFromDirectory } from '../helpers/fixtureLoader';

const FIXTURE_ROOT = getFixtureRoot('DiMapper.Sample');
const SCOPE = { fsPath: FIXTURE_ROOT, toString: () => FIXTURE_ROOT };

describe('incremental pipeline', () => {
  it('updates issues when an implementation class ctor changes without touching Program.cs', async () => {
    const files = loadCsFilesFromDirectory(FIXTURE_ROOT);
    const fileAccess = new InMemoryScannerFileAccess(files);
    const deps = createScanPipelineDeps(fileAccess);

    const full = await runScanPipeline(
      {
        mode: 'full',
        scopeRoot: SCOPE,
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      deps,
    );

    const orderPath = path.join(FIXTURE_ROOT, 'Services/OrderService.cs').replace(/\\/g, '/');

    const unregisteredBefore = full.graph.issues.filter(
      (i) => i.kind === 'UNREGISTERED' && i.relatedType === 'IPaymentGateway',
    ).length;
    expect(unregisteredBefore).toBeGreaterThanOrEqual(1);

    const mutatedOrderService = files[orderPath].replace(
      'IPaymentGateway paymentGateway, IClock clock',
      'IPaymentGateway paymentGateway, IClock clock, IAuditLogger audit',
    );

    const mutatedFiles = { ...files, [orderPath]: mutatedOrderService };
    const incrementalDeps = createScanPipelineDeps(new InMemoryScannerFileAccess(mutatedFiles));

    const incremental = await runScanPipeline(
      {
        mode: 'incremental',
        scopeRoot: SCOPE,
        changedFiles: [{ fsPath: orderPath, toString: () => orderPath }],
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      incrementalDeps,
      {
        existingRegistrations: full.graph.registrations,
        readFile: async (uri) => mutatedFiles[uri.fsPath.replace(/\\/g, '/')] ?? '',
      },
    );

    const programRegistrations = incremental.graph.registrations.filter((r) =>
      r.location.fileUri.replace(/\\/g, '/').includes('Program.cs'),
    );
    expect(programRegistrations.length).toBeGreaterThan(0);

    const unregisteredAfter = incremental.graph.issues.filter((i) => i.kind === 'UNREGISTERED');
    expect(unregisteredAfter.some((i) => i.relatedType === 'IAuditLogger')).toBe(true);

    const merged = mergeRegistrations(full.graph.registrations, [`file:///${orderPath}`], []);
    expect(merged.length).toBe(full.graph.registrations.length);
  });
});