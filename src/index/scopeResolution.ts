import * as path from 'node:path';

export type DiscoveredFileKind = 'sln' | 'csproj' | 'hostEntry';

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  workspaceRoot: string;
  kind: DiscoveredFileKind;
  /** Path segment depth relative to workspace root (lower = shallower). */
  depth: number;
}

export interface ScopeResolutionInput {
  projectPathConfig?: string;
  workspaceRoots: string[];
  discoveredFiles: DiscoveredFile[];
  /** When true, a discovered .sln scopes the entire solution folder. Default: startup project only. */
  scanEntireSolution?: boolean;
}

export type ScopeSource = 'config' | 'sln' | 'startupProject' | 'hostEntry' | 'csproj';

export interface ScopeResolutionResult {
  scopeRoot: string;
  source: ScopeSource;
}

const HOST_ENTRY_FILES = new Set(['program.cs', 'startup.cs']);
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);

/**
 * Deterministic scopeRoot resolution.
 * Precedence: projectPath config > .sln (startup project or whole solution) > host entry > .csproj
 */
export function resolveScopeRoot(input: ScopeResolutionInput): ScopeResolutionResult | undefined {
  const normalizedRoots = input.workspaceRoots.map(normalizeDir).filter(Boolean);

  if (input.projectPathConfig?.trim()) {
    const configured = resolveConfiguredPath(input.projectPathConfig.trim(), normalizedRoots);
    if (configured) {
      return { scopeRoot: configured, source: 'config' };
    }
  }

  const slnCandidates = input.discoveredFiles
    .filter((f) => f.kind === 'sln')
    .map((f) => ({ dir: path.dirname(f.absolutePath), sortKey: normalizeDir(f.absolutePath) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (slnCandidates.length > 0) {
    if (input.scanEntireSolution) {
      return { scopeRoot: slnCandidates[0].dir, source: 'sln' };
    }

    const startupProject = resolveStartupProjectDir(
      slnCandidates[0].dir,
      input.discoveredFiles,
      normalizedRoots,
    );
    if (startupProject) {
      return { scopeRoot: startupProject, source: 'startupProject' };
    }

    return { scopeRoot: slnCandidates[0].dir, source: 'sln' };
  }

  const hostCandidates = input.discoveredFiles
    .filter((f) => f.kind === 'hostEntry')
    .sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return normalizeDir(a.absolutePath).localeCompare(normalizeDir(b.absolutePath));
    });

  if (hostCandidates.length > 0) {
    return { scopeRoot: path.dirname(hostCandidates[0].absolutePath), source: 'hostEntry' };
  }

  const csprojCandidates = input.discoveredFiles
    .filter((f) => f.kind === 'csproj')
    .map((f) => ({ dir: path.dirname(f.absolutePath), sortKey: normalizeDir(f.absolutePath) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (csprojCandidates.length > 0) {
    return { scopeRoot: csprojCandidates[0].dir, source: 'csproj' };
  }

  return undefined;
}

export function resolveConfiguredPath(
  projectPathConfig: string,
  workspaceRoots: string[],
): string | undefined {
  if (path.isAbsolute(projectPathConfig)) {
    return normalizeDir(projectPathConfig);
  }

  for (const root of workspaceRoots) {
    const candidate = path.join(root, projectPathConfig);
    if (isDirectoryCandidate(candidate)) {
      return normalizeDir(candidate);
    }
  }

  return undefined;
}

export function classifyDiscoveredFile(
  absolutePath: string,
  workspaceRoot: string,
): DiscoveredFile | undefined {
  const normalized = normalizeDir(absolutePath);
  const root = normalizeDir(workspaceRoot);
  const base = path.basename(normalized).toLowerCase();
  const relativePath = path.relative(root, normalized);

  if (base.endsWith('.sln')) {
    return makeDiscovered(normalized, relativePath, root, 'sln', depthOf(relativePath));
  }

  if (base.endsWith('.csproj')) {
    return makeDiscovered(normalized, relativePath, root, 'csproj', depthOf(relativePath));
  }

  if (HOST_ENTRY_FILES.has(base)) {
    return makeDiscovered(normalized, relativePath, root, 'hostEntry', depthOf(relativePath));
  }

  return undefined;
}

/** BFS directory names to skip when enumerating host entries (for documentation / callers). */
export function shouldSkipDirectoryName(name: string): boolean {
  return SKIP_DIRS.has(name.toLowerCase());
}

function makeDiscovered(
  absolutePath: string,
  relativePath: string,
  workspaceRoot: string,
  kind: DiscoveredFileKind,
  depth: number,
): DiscoveredFile {
  return { absolutePath, relativePath, workspaceRoot, kind, depth };
}

function depthOf(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized === '.') {
    return 0;
  }
  return normalized.split('/').filter(Boolean).length - 1;
}

function normalizeDir(dirPath: string): string {
  return path.normalize(dirPath);
}

function isDirectoryCandidate(_dirPath: string): boolean {
  // Pure resolver accepts configured paths; existence is validated by the caller (IndexManager).
  return true;
}

/** Demo, test, and sample projects are excluded when picking a startup project under a solution. */
export function isAuxiliaryProjectDir(projectDir: string): boolean {
  const name = path.basename(projectDir).toLowerCase();
  return (
    name.includes('demo') ||
    name.includes('unittest') ||
    name.includes('sample') ||
    name.endsWith('.tests') ||
    name.endsWith('tests') ||
    name.endsWith('.test')
  );
}

function resolveStartupProjectDir(
  solutionDir: string,
  discoveredFiles: DiscoveredFile[],
  workspaceRoots: string[],
): string | undefined {
  const normalizedSolution = normalizeDir(solutionDir);
  const hostEntries = discoveredFiles
    .filter((file) => file.kind === 'hostEntry')
    .filter((file) => isUnderDir(file.absolutePath, normalizedSolution))
    .map((file) => ({
      file,
      projectDir: path.dirname(file.absolutePath),
    }))
    .filter(({ projectDir }) => !isAuxiliaryProjectDir(projectDir));

  if (hostEntries.length === 0) {
    return undefined;
  }

  const workspaceMatch = pickHostEntryMatchingWorkspace(hostEntries, workspaceRoots);
  if (workspaceMatch) {
    return path.dirname(workspaceMatch.absolutePath);
  }

  hostEntries.sort((a, b) => compareHostEntries(a.file, b.file));
  return hostEntries[0].projectDir;
}

function pickHostEntryMatchingWorkspace(
  hostEntries: Array<{ file: DiscoveredFile; projectDir: string }>,
  workspaceRoots: string[],
): DiscoveredFile | undefined {
  const workspaceNames = new Set(
    workspaceRoots.map((root) => path.basename(normalizeDir(root)).toLowerCase()),
  );

  const matched = hostEntries.filter(({ projectDir }) =>
    workspaceNames.has(path.basename(projectDir).toLowerCase()),
  );

  if (matched.length === 0) {
    return undefined;
  }

  matched.sort((a, b) => compareHostEntries(a.file, b.file));
  return matched[0].file;
}

function compareHostEntries(a: DiscoveredFile, b: DiscoveredFile): number {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  return normalizeDir(a.absolutePath).localeCompare(normalizeDir(b.absolutePath));
}

function isUnderDir(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizeDir(filePath).replace(/\\/g, '/').toLowerCase();
  const normalizedDir = normalizeDir(dirPath).replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
  return normalizedFile.startsWith(`${normalizedDir}/`) || normalizedFile === normalizedDir;
}