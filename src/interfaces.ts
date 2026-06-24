/**
 * Injectable service interfaces for ScanPipeline stages.
 * @see docs/di-container-mapper-design.md — ScanPipeline orchestration
 */

import type {
  DependencyEdge,
  DiGraph,
  DiIssue,
  InjectionSite,
  Registration,
  ScanStageError,
  ScannerVersion,
} from './types';

/** Minimal URI shape — avoids importing vscode in pure modules. */
export interface UriLike {
  fsPath: string;
  toString(): string;
}

export interface ScanContext {
  fileUri: UriLike;
  text: string;
  projectRoot?: string;
}

export interface IRegistrationScanner {
  scanFile(ctx: ScanContext, options: ScanOptions): Promise<Registration[]>;
  scanWorkspace(scopeRoot: UriLike, options: ScanOptions): Promise<Registration[]>;
}

export interface IExtensionMethodResolver {
  /**
   * Expands extension-method registration calls into direct Add* registrations.
   * v1: searches only under scopeRoot.
   */
  resolve(
    registrations: Registration[],
    scopeRoot: UriLike,
    signal?: AbortSignal,
    scanOptions?: ScanOptions,
  ): Promise<Registration[]>;
}

export interface ConstructorInspectResult {
  registrationId: string;
  implementationType: string;
  implFileUri?: string;
  implFileText?: string;
  edges: DependencyEdge[];
}

export interface InjectionSiteScanResult {
  sites: InjectionSite[];
  hostFileTexts: Record<string, string>;
}

export interface IInjectionSiteScanner {
  scan(
    registrations: Registration[],
    scopeRoot: UriLike,
    signal?: AbortSignal,
  ): Promise<InjectionSiteScanResult>;
}

export interface IConstructorInspector {
  inspect(
    registrations: Registration[],
    scopeRoot: UriLike,
    signal?: AbortSignal,
  ): Promise<ConstructorInspectResult[]>;

  /** Locate the file declaring an implementation type (used for implFileToRegistrationIds). */
  locateImplFile(implementationType: string, scopeRoot: UriLike): Promise<string | undefined>;
}

export interface GraphBuildResult {
  registrations: Registration[];
  edges: DependencyEdge[];
  adjacency: Map<string, string[]>;
  transitive: Map<string, Set<string>>;
  indexedAt: number;
  scannerVersion: ScannerVersion;
}

export interface ScanOptions {
  /** When true, treat `services.Replace(ServiceDescriptor.*<...>())` as registrations. Default: true. */
  includeServiceDescriptorReplace: boolean;
  /** When true, skip files under test project folders (*Tests, *UnitTest, etc.). Default: true. */
  excludeTestProjects: boolean;
  /** When true, parse `AddKeyed*` / `TryAddKeyed*` registrations (.NET 8+). Default: false. */
  enableKeyed: boolean;
}

export interface ScanPipelineInput {
  mode: 'full' | 'incremental';
  scopeRoot: UriLike;
  changedFiles?: UriLike[];
  scannerVersion: ScannerVersion;
  scanOptions: ScanOptions;
}

export interface ScanPipelineResult {
  graph: DiGraph;
  errors: ScanStageError[];
  implFileToRegistrationIds?: Record<string, string[]>;
}

/** Injectable stage implementations — enables unit tests with mocks (PR 2/6). */
export interface ScanPipelineDeps {
  scanner: IRegistrationScanner;
  extensionMethodResolver: IExtensionMethodResolver;
  constructorInspector: IConstructorInspector;
  injectionSiteScanner: IInjectionSiteScanner;
  buildGraph: (
    registrations: Registration[],
    edges: DependencyEdge[],
    scannerVersion: ScannerVersion,
  ) => Omit<DiGraph, 'issues'>;
  detectIssues: (graph: DiGraph) => DiIssue[];
  roslynClient?: IRoslynHostClient;
}

export interface RoslynScanRequest {
  solutionPath?: string;
  projectPath?: string;
  changedFiles?: string[];
  includeServiceDescriptorReplace?: boolean;
  excludeTestProjects?: boolean;
  enableKeyed?: boolean;
}

export interface RoslynScanResult {
  registrations: Registration[];
  edges: DependencyEdge[];
  errors: ScanStageError[];
}

export interface IRoslynHostClient {
  ping(): Promise<boolean>;
  scan(request: RoslynScanRequest, signal?: AbortSignal): Promise<RoslynScanResult>;
  shutdown(): Promise<void>;
}