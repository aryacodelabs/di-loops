import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScanPipeline } from '../../src/index/scanPipeline';
import { createScanPipelineDeps } from '../../src/index/pipelineFactory';
import { createScanOptions } from '../../src/scanOptions';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';
import { getFixtureRoot, loadCsFilesFromDirectory } from '../helpers/fixtureLoader';

const FIXTURE_ROOT = getFixtureRoot('DiMapper.Sample');
const SCOPE = { fsPath: FIXTURE_ROOT, toString: () => FIXTURE_ROOT };

describe('DiMapper.Sample fixture pipeline', () => {
  it('detects planted DI issues end-to-end', async () => {
    const files = loadCsFilesFromDirectory(FIXTURE_ROOT);
    const fileAccess = new InMemoryScannerFileAccess(files);
    const deps = createScanPipelineDeps(fileAccess);

    const result = await runScanPipeline(
      {
        mode: 'full',
        scopeRoot: SCOPE,
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      deps,
    );

    const kinds = result.graph.issues.map((issue) => issue.kind);
    const serviceTypes = result.graph.registrations.map((r) => r.serviceType).sort();

    expect(serviceTypes).toContain('IAppHost');
    expect(serviceTypes).toContain('IEmailSender');
    expect(serviceTypes).toContain('IOrderService');
    expect(serviceTypes.filter((t) => t === 'IEmailSender').length).toBe(2);

    expect(kinds).toContain('CAPTURED_SCOPED');
    expect(kinds).toContain('TRAPPED_TRANSIENT');
    expect(kinds).toContain('DUPLICATE');
    expect(kinds.filter((k) => k === 'UNREGISTERED').length).toBeGreaterThanOrEqual(1);

    const orderServiceEdges = result.graph.edges.filter((edge) =>
      result.graph.registrations.some(
        (r) => r.id === edge.fromRegistrationId && r.implementationType === 'OrderService',
      ),
    );
    expect(orderServiceEdges.length).toBe(3);

    const multiCtorEdges = result.graph.edges.filter((edge) =>
      result.graph.registrations.some(
        (r) => r.id === edge.fromRegistrationId && r.implementationType === 'MultiCtorService',
      ),
    );
    expect(multiCtorEdges.length).toBe(2);
    expect(multiCtorEdges.map((e) => e.toType).sort()).toEqual(['IClock', 'IOrderRepository']);

    expect(path.normalize(result.graph.registrations[0].projectPath ?? FIXTURE_ROOT)).toBeTruthy();
  });
});