import type {
  ConstructorInspectResult,
  ScanPipelineDeps,
  ScanPipelineInput,
  ScanPipelineResult,
  UriLike,
} from '../interfaces';
import type { DiGraph, Registration, ScanStageError } from '../types';
import { mergeRegistrations } from './diIndexCache';
import { runRoslynScanPipeline } from './roslynScanPipeline';

export async function runScanPipeline(
  input: ScanPipelineInput,
  deps: ScanPipelineDeps,
  options?: {
    signal?: AbortSignal;
    existingRegistrations?: Registration[];
    readFile?: (uri: UriLike) => Promise<string>;
    preferRoslyn?: boolean;
  },
): Promise<ScanPipelineResult> {
  if (input.scannerVersion === 'roslyn-v2' && options?.preferRoslyn && deps.roslynClient) {
    try {
      return await runRoslynScanPipeline(input, deps, {
        signal: options.signal,
        existingRegistrations: options.existingRegistrations,
        changedFiles: input.changedFiles?.map((file) => file.fsPath),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = await runRegexScanPipeline(input, deps, options);
      fallback.errors.unshift({
        stage: 'scanner',
        message: `Roslyn scan failed, fell back to regex: ${message}`,
      });
      return fallback;
    }
  }

  return runRegexScanPipeline(input, deps, options);
}

async function runRegexScanPipeline(
  input: ScanPipelineInput,
  deps: ScanPipelineDeps,
  options?: {
    signal?: AbortSignal;
    existingRegistrations?: Registration[];
    readFile?: (uri: UriLike) => Promise<string>;
  },
): Promise<ScanPipelineResult> {
  const errors: ScanStageError[] = [];
  const signal = options?.signal;

  throwIfAborted(signal);

  let registrations: Registration[];

  try {
    if (input.mode === 'full') {
      registrations = await deps.scanner.scanWorkspace(input.scopeRoot, input.scanOptions);
    } else {
      const changedFiles = input.changedFiles ?? [];
      const delta: Registration[] = [];

      for (const fileUri of changedFiles) {
        throwIfAborted(signal);
        try {
          const text = await readChangedFile(fileUri, options?.readFile);
          const fileRegs = await deps.scanner.scanFile(
            {
              fileUri,
              text,
              projectRoot: input.scopeRoot.fsPath,
            },
            input.scanOptions,
          );
          delta.push(...fileRegs);
        } catch (error) {
          errors.push({
            stage: 'scanner',
            fileUri: fileUri.toString(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      registrations = mergeRegistrations(options?.existingRegistrations ?? [], changedFiles, delta);
    }
  } catch (error) {
    errors.push({
      stage: 'scanner',
      message: error instanceof Error ? error.message : String(error),
    });
    registrations = input.mode === 'incremental' ? (options?.existingRegistrations ?? []) : [];
  }

  throwIfAborted(signal);

  try {
    registrations = await deps.extensionMethodResolver.resolve(
      registrations,
      input.scopeRoot,
      signal,
      input.scanOptions,
    );
  } catch (error) {
    errors.push({
      stage: 'resolver',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  throwIfAborted(signal);

  let edges: DiGraph['edges'] = [];
  let inspectResults: ConstructorInspectResult[] = [];

  try {
    inspectResults = await deps.constructorInspector.inspect(
      registrations,
      input.scopeRoot,
      signal,
    );
    edges = inspectResults.flatMap((result) => result.edges);
  } catch (error) {
    errors.push({
      stage: 'constructor',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  throwIfAborted(signal);

  let injectionSites: import('../types').InjectionSite[] = [];
  let hostFileTexts: Record<string, string> = {};
  try {
    const injectionScan = await deps.injectionSiteScanner.scan(registrations, input.scopeRoot, signal);
    injectionSites = injectionScan.sites;
    hostFileTexts = injectionScan.hostFileTexts;
  } catch (error) {
    errors.push({
      stage: 'issues',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  throwIfAborted(signal);

  let partialGraph: Omit<DiGraph, 'issues'>;

  try {
    partialGraph = deps.buildGraph(registrations, edges, input.scannerVersion);
  } catch (error) {
    errors.push({
      stage: 'graph',
      message: error instanceof Error ? error.message : String(error),
    });
    partialGraph = deps.buildGraph(registrations, [], input.scannerVersion);
  }

  let issues: DiGraph['issues'] = [];

  try {
    const implFileTexts: Record<string, string> = {};
    const implFileUris: Record<string, string> = {};
    const implFileToRegistrationIds: Record<string, string[]> = {};

    for (const result of inspectResults) {
      if (result.implFileText) {
        implFileTexts[result.registrationId] = result.implFileText;
      }
      if (result.implFileUri) {
        implFileUris[result.registrationId] = result.implFileUri;
      }
      if (result.implFileUri) {
        const ids = implFileToRegistrationIds[result.implFileUri] ?? [];
        ids.push(result.registrationId);
        implFileToRegistrationIds[result.implFileUri] = ids;
      }
    }

    const graphForDetection: DiGraph = {
      ...partialGraph,
      issues: [],
      detectionContext: {
        implFileTexts,
        implFileUris,
        hostFileTexts,
        scopeRoot: input.scopeRoot.fsPath,
        injectionSites,
      },
    };
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
    implFileToRegistrationIds: buildImplFileMap(inspectResults),
  };
}

function buildImplFileMap(
  inspectResults: ConstructorInspectResult[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const result of inspectResults) {
    if (!result.implFileUri) {
      continue;
    }
    const ids = map[result.implFileUri] ?? [];
    ids.push(result.registrationId);
    map[result.implFileUri] = ids;
  }
  return map;
}

async function readChangedFile(
  uri: UriLike,
  readFile?: (uri: UriLike) => Promise<string>,
): Promise<string> {
  if (!readFile) {
    throw new Error('readFile is required for incremental scans');
  }
  return readFile(uri);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Scan aborted');
  }
}