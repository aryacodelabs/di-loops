import { describe, expect, it } from 'vitest';
import { runScanPipeline } from '../../src/index/scanPipeline';
import { createStubScanPipelineDeps } from '../../src/index/stubPipelineStages';
import { createScanOptions } from '../../src/scanOptions';
import { parseRegistrationsFromText } from '../../src/scanner/regexRegistrationScanner';
import type { IRegistrationScanner, ScanContext, ScanOptions, UriLike } from '../../src/interfaces';
import type { Registration } from '../../src/types';

const SCOPE: UriLike = { fsPath: 'C:/projects/MyApp', toString: () => 'file:///c:/projects/MyApp' };
const PROGRAM = 'file:///c:/projects/MyApp/Program.cs';

const PROGRAM_SOURCE = `
builder.Services.AddSingleton<IFooService, FooService>();
`;

class InMemoryScanner implements IRegistrationScanner {
  async scanFile(ctx: ScanContext, options: ScanOptions): Promise<Registration[]> {
    return parseRegistrationsFromText(
      ctx.text,
      ctx.fileUri.toString(),
      ctx.projectRoot ?? SCOPE.fsPath,
      options,
    );
  }

  async scanWorkspace(_scopeRoot: UriLike, options: ScanOptions): Promise<Registration[]> {
    return this.scanFile(
      {
        fileUri: { fsPath: PROGRAM, toString: () => PROGRAM },
        text: PROGRAM_SOURCE,
        projectRoot: SCOPE.fsPath,
      },
      options,
    );
  }
}

describe('runScanPipeline', () => {
  it('runs full scan and returns registrations with empty edges/issues (stub stages)', async () => {
    const deps = createStubScanPipelineDeps({ scanner: new InMemoryScanner() });
    const result = await runScanPipeline(
      { mode: 'full', scopeRoot: SCOPE, scannerVersion: 'regex-v1', scanOptions: createScanOptions() },
      deps,
    );

    expect(result.graph.registrations).toHaveLength(1);
    expect(result.graph.registrations[0].serviceType).toBe('IFooService');
    expect(result.graph.edges).toEqual([]);
    expect(result.graph.issues).toEqual([]);
    expect(result.graph.scannerVersion).toBe('regex-v1');
    expect(result.errors).toEqual([]);
  });

  it('merges incremental registration deltas by changed file', async () => {
    const deps = createStubScanPipelineDeps({ scanner: new InMemoryScanner() });
    const servicesFile = 'file:///c:/projects/MyApp/Services.cs';
    const existing: Registration[] = [
      {
        id: 'keep',
        serviceType: 'IKeep',
        implementationType: 'Keep',
        lifetime: 'Singleton',
        isTryAdd: false,
        isFactory: false,
        location: {
          fileUri: servicesFile,
          range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
        },
      },
    ];

    const result = await runScanPipeline(
      {
        mode: 'incremental',
        scopeRoot: SCOPE,
        changedFiles: [{ fsPath: PROGRAM, toString: () => PROGRAM }],
        scannerVersion: 'regex-v1',
        scanOptions: createScanOptions(),
      },
      deps,
      {
        existingRegistrations: existing,
        readFile: async () => PROGRAM_SOURCE,
      },
    );

    expect(result.graph.registrations).toHaveLength(2);
    expect(result.graph.registrations.map((r) => r.id)).toContain('keep');
    expect(result.graph.registrations.some((r) => r.serviceType === 'IFooService')).toBe(true);
  });
});