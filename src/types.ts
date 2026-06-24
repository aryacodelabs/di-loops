/**
 * Core domain types for DI Container Mapper.
 * @see docs/di-container-mapper-design.md — API / Interface Changes
 */

export type Lifetime = 'Singleton' | 'Scoped' | 'Transient';

export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface SourceLocation {
  fileUri: string;
  range: SourceRange;
  lineText?: string;
}

export interface Registration {
  /** Stable logical key — survives line shifts on edit. */
  id: string;
  /** Interface or concrete service type as written in source. */
  serviceType: string;
  implementationType: string;
  lifetime: Lifetime;
  isTryAdd: boolean;
  isFactory: boolean;
  /** v2.5 keyed services */
  key?: string;
  location: SourceLocation;
  projectPath?: string;
}

export type DependencyResolution = 'constructor' | 'factory' | 'keyed';

export interface DependencyEdge {
  fromRegistrationId: string;
  toType: string;
  resolution: DependencyResolution;
  toRegistrationId?: string;
}

export type IssueKind =
  | 'CAPTURED_SCOPED'
  | 'TRAPPED_TRANSIENT'
  | 'UNREGISTERED'
  | 'UNREGISTERED_LOW_CONFIDENCE'
  | 'DUPLICATE';

export type IssueSeverity = 'error' | 'warning';

export type MatchConfidence = 'high' | 'medium' | 'low';

export type RegistryMatchKind =
  | 'exact'
  | 'simpleName'
  | 'usingResolved'
  | 'suffix'
  | 'ambiguous'
  | 'none';

export interface RegistryLookupResult {
  registration?: Registration;
  confidence: MatchConfidence;
  matchKind: RegistryMatchKind;
}

export interface DiIssue {
  kind: IssueKind;
  /** Mirrors kind or sub-variant — maps to vscode.Diagnostic.code */
  code: string;
  severity: IssueSeverity;
  message: string;
  registrationId?: string;
  relatedType?: string;
  location: SourceLocation;
  matchConfidence?: MatchConfidence;
  matchKind?: RegistryMatchKind;
}

export type ScannerVersion = 'regex-v1' | 'roslyn-v2';

export interface InjectionSite {
  hostTypeName: string;
  parameterType: string;
  fileUri: string;
  range: SourceRange;
  lineText?: string;
}

export interface IssueDetectionContext {
  implFileTexts: Record<string, string>;
  /** Implementation class file per registration id — used for accurate using-aware lookup. */
  implFileUris: Record<string, string>;
  /** Source file text for injection hosts (controllers, etc.) keyed by fileUri. */
  hostFileTexts?: Record<string, string>;
  scopeRoot: string;
  injectionSites?: InjectionSite[];
}

export interface DiGraph {
  registrations: Registration[];
  edges: DependencyEdge[];
  issues: DiIssue[];
  indexedAt: number;
  scannerVersion: ScannerVersion;
  /** Direct adjacency for UI expansion — not used by issue rules. */
  adjacency?: Record<string, string[]>;
  /** Transitive closure for UI — not used by issue rules. */
  transitive?: Record<string, string[]>;
  /** Populated before issue detection; stripped from cached graph. */
  detectionContext?: IssueDetectionContext;
}

export interface DiIndexCache {
  graph: DiGraph;
  /** Registration location fileUri → registration ids */
  fileToRegistrationIds: Map<string, string[]>;
  /** Implementation class declaration fileUri → registration ids */
  implFileToRegistrationIds: Map<string, string[]>;
  version: number;
}

export interface ScanStageError {
  stage: 'scanner' | 'resolver' | 'constructor' | 'graph' | 'issues';
  fileUri?: string;
  message: string;
}

export function createEmptyGraph(scannerVersion: ScannerVersion = 'regex-v1'): DiGraph {
  return {
    registrations: [],
    edges: [],
    issues: [],
    indexedAt: Date.now(),
    scannerVersion,
  };
}

export function createEmptyIndexCache(scannerVersion: ScannerVersion = 'regex-v1'): DiIndexCache {
  return {
    graph: createEmptyGraph(scannerVersion),
    fileToRegistrationIds: new Map(),
    implFileToRegistrationIds: new Map(),
    version: 0,
  };
}