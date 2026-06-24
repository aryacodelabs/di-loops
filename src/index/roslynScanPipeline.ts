import type { ScanPipelineDeps, ScanPipelineInput, ScanPipelineResult } from '../interfaces';
import { resolveRoslynScanPaths } from '../roslyn/workspacePaths';
import type { DiGraph } from '../types';
import { mergeRegistrations } from './diIndexCache';

export async function runRoslynScanPipeline(
  input: ScanPipelineInput,
  deps: ScanPipelineDeps,
  options?: {
    signal?: AbortSignal;
    existingRegistrations?: import('../types').Registration[];
    changedFiles?: string[];
  },
): Promise<ScanPipelineResult> {
  const client = deps.roslynClient;
  if (!client) {
    throw new Error('Roslyn client is not configured');
  }

  const paths = resolveRoslynScanPaths(input.scopeRoot.fsPath);
  const scanResult = await client.scan(
    {
      solutionPath: paths.solutionPath,
      projectPath: paths.projectPath ?? input.scopeRoot.fsPath,
      changedFiles: options?.changedFiles,
      includeServiceDescriptorReplace: input.scanOptions.includeServiceDescriptorReplace,
      excludeTestProjects: input.scanOptions.excludeTestProjects,
      enableKeyed: input.scanOptions.enableKeyed,
    },
    options?.signal,
  );

  let registrations = scanResult.registrations;
  if (input.mode === 'incremental' && options?.existingRegistrations) {
    const changedUris = (options.changedFiles ?? []).map((file) => toFileUri(file));
    registrations = mergeRegistrations(
      options.existingRegistrations,
      changedUris,
      scanResult.registrations,
    );
  }

  const partialGraph = deps.buildGraph(registrations, scanResult.edges, 'roslyn-v2');

  let injectionSites: import('../types').InjectionSite[] = [];
  let hostFileTexts: Record<string, string> = {};
  const errors = [...scanResult.errors];

  try {
    const injectionScan = await deps.injectionSiteScanner.scan(
      registrations,
      input.scopeRoot,
      options?.signal,
    );
    injectionSites = injectionScan.sites;
    hostFileTexts = injectionScan.hostFileTexts;
  } catch (error) {
    errors.push({
      stage: 'issues',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const graphForDetection: DiGraph = {
    ...partialGraph,
    issues: [],
    detectionContext: {
      implFileTexts: {},
      implFileUris: {},
      hostFileTexts,
      scopeRoot: input.scopeRoot.fsPath,
      injectionSites,
    },
  };

  let issues: DiGraph['issues'] = [];
  try {
    issues = deps.detectIssues(graphForDetection);
  } catch (error) {
    errors.push({
      stage: 'issues',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    graph: {
      ...partialGraph,
      issues,
    },
    errors,
  };
}

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}