import type {
  ConstructorInspectResult,
  IConstructorInspector,
  IExtensionMethodResolver,
  IInjectionSiteScanner,
  ScanPipelineDeps,
  UriLike,
} from '../interfaces';
import type { DependencyEdge, DiGraph, DiIssue, Registration, ScannerVersion } from '../types';

/** Passthrough resolver — replaced in PR 5. */
export const passthroughExtensionMethodResolver: IExtensionMethodResolver = {
  async resolve(registrations: Registration[]): Promise<Registration[]> {
    return registrations;
  },
};

/** No-op inspector — replaced in PR 4. */
export const noopConstructorInspector: IConstructorInspector = {
  async inspect(registrations: Registration[]): Promise<ConstructorInspectResult[]> {
    return registrations.map((registration) => ({
      registrationId: registration.id,
      implementationType: registration.implementationType,
      edges: [],
    }));
  },

  async locateImplFile(): Promise<string | undefined> {
    return undefined;
  },
};

export function buildGraphStub(
  registrations: Registration[],
  edges: DependencyEdge[],
  scannerVersion: ScannerVersion,
): Omit<DiGraph, 'issues'> {
  return {
    registrations,
    edges,
    indexedAt: Date.now(),
    scannerVersion,
  };
}

export function detectIssuesStub(): DiIssue[] {
  return [];
}

/** No-op injection site scanner — replaced in injection-site PR. */
export const noopInjectionSiteScanner: IInjectionSiteScanner = {
  async scan() {
    return { sites: [], hostFileTexts: {} };
  },
};

export function createStubScanPipelineDeps(
  overrides: Partial<ScanPipelineDeps> & Pick<ScanPipelineDeps, 'scanner'>,
): ScanPipelineDeps {
  return {
    extensionMethodResolver: passthroughExtensionMethodResolver,
    constructorInspector: noopConstructorInspector,
    injectionSiteScanner: noopInjectionSiteScanner,
    buildGraph: buildGraphStub,
    detectIssues: detectIssuesStub,
    ...overrides,
  };
}

export function uriKey(uri: UriLike): string {
  return uri.toString();
}