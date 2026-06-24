import * as vscode from 'vscode';
import type { DiGraph, ScanStageError } from '../types';
import { VsCodeScannerFileAccess } from '../scanner/scannerFileAccess';
import { DiIndexCacheStore } from './diIndexCache';
import { discoverWorkspaceFiles, getWorkspaceRoots } from './workspaceDiscovery';
import type { RoslynHostManager } from '../roslyn/roslynHostManager';
import { createScanPipelineDeps } from './pipelineFactory';
import { resolveConfiguredPath, resolveScopeRoot } from './scopeResolution';
import { createScanOptions } from '../scanOptions';
import { runScanPipeline } from './scanPipeline';

const DEBOUNCE_MS = 300;

export interface IndexManagerOptions {
  log?: (message: string) => void;
  onScopeMissing?: () => void;
  roslynHostManager?: RoslynHostManager;
}

export class IndexManager implements vscode.Disposable {
  private readonly cache = new DiIndexCacheStore();
  private readonly fileAccess = new VsCodeScannerFileAccess();
  private readonly regexPipelineDeps = createScanPipelineDeps(this.fileAccess);
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onIndexChangedEmitter = new vscode.EventEmitter<DiGraph>();
  private readonly disposables: vscode.Disposable[] = [];

  private scopeRoot?: vscode.Uri;
  private scopeSource?: string;
  private scanAbort?: AbortController;
  private scanInFlight = false;
  private scopeMissingNotified = false;

  readonly onIndexChanged = this.onIndexChangedEmitter.event;

  constructor(private readonly options: IndexManagerOptions = {}) {}

  async initialize(): Promise<void> {
    await this.resolveScope();
    if (this.scopeRoot) {
      await this.fullScan();
    } else {
      this.notifyScopeMissing();
    }
  }

  getGraph(): DiGraph {
    return this.cache.getGraph();
  }

  getScopeRoot(): vscode.Uri | undefined {
    return this.scopeRoot;
  }

  async fullScan(): Promise<DiGraph> {
    if (!this.scopeRoot) {
      await this.resolveScope();
      if (!this.scopeRoot) {
        this.notifyScopeMissing();
        return this.cache.getGraph();
      }
    }

    return this.runScan('full');
  }

  scheduleIncrementalScan(document: vscode.TextDocument): void {
    if (!this.getConfig().scanOnSave || document.languageId !== 'csharp') {
      return;
    }

    const uriKey = document.uri.toString();
    const existing = this.debounceTimers.get(uriKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(uriKey);
      void this.incrementalScan(document.uri);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(uriKey, timer);
  }

  async incrementalScan(fileUri: vscode.Uri): Promise<void> {
    if (!this.scopeRoot) {
      return;
    }

    if (!isUnderScope(fileUri.fsPath, this.scopeRoot.fsPath)) {
      return;
    }

    await this.runScan('incremental', [fileUri]);
  }

  async resolveScope(): Promise<vscode.Uri | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.scopeRoot = undefined;
      return undefined;
    }

    const workspaceRoots = getWorkspaceRoots(folders);
    const discovered = await discoverWorkspaceFiles(folders);
    const projectPathConfig = await this.resolveValidProjectPath(workspaceRoots);
    const result = resolveScopeRoot({
      projectPathConfig,
      workspaceRoots,
      discoveredFiles: discovered,
      scanEntireSolution: this.getConfig().scanEntireSolution,
    });

    if (!result) {
      this.scopeRoot = undefined;
      this.scopeSource = undefined;
      return undefined;
    }

    this.scopeRoot = vscode.Uri.file(result.scopeRoot);
    this.scopeSource = result.source;
    this.scopeMissingNotified = false;
    this.log(
      `Scope resolved via ${result.source}: ${result.scopeRoot}`,
    );
    return this.scopeRoot;
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.scanAbort?.abort();
    void this.options.roslynHostManager?.dispose();
    this.onIndexChangedEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async shouldUseRoslyn(): Promise<boolean> {
    if (!this.getConfig().useRoslyn || !this.options.roslynHostManager) {
      return false;
    }

    const client = await this.options.roslynHostManager.getClient();
    return client !== undefined;
  }

  private async resolvePipelineDeps(roslynEnabled: boolean) {
    if (!roslynEnabled || !this.options.roslynHostManager) {
      return this.regexPipelineDeps;
    }

    const client = await this.options.roslynHostManager.getClient();
    if (!client) {
      return this.regexPipelineDeps;
    }

    return {
      ...this.regexPipelineDeps,
      roslynClient: client,
    };
  }

  private async runScan(
    mode: 'full' | 'incremental',
    changedFiles?: vscode.Uri[],
  ): Promise<DiGraph> {
    if (!this.scopeRoot) {
      return this.cache.getGraph();
    }

    if (this.scanInFlight) {
      this.scanAbort?.abort();
    }

    this.scanInFlight = true;
    this.scanAbort = new AbortController();
    const signal = this.scanAbort.signal;

    try {
      const roslynEnabled = await this.shouldUseRoslyn();
      const scanOptions = this.getScanOptions();
      const result = await runScanPipeline(
        {
          mode,
          scopeRoot: { fsPath: this.scopeRoot.fsPath, toString: () => this.scopeRoot!.toString() },
          changedFiles: changedFiles?.map((uri) => ({
            fsPath: uri.fsPath,
            toString: () => uri.toString(),
          })),
          scannerVersion: roslynEnabled ? 'roslyn-v2' : 'regex-v1',
          scanOptions,
        },
        await this.resolvePipelineDeps(roslynEnabled),
        {
          signal,
          existingRegistrations: this.cache.getRegistrations(),
          preferRoslyn: roslynEnabled,
          readFile: async (uri) => {
            const vscodeUri = vscode.Uri.parse(uri.toString());
            const openDoc = vscode.workspace.textDocuments.find(
              (doc) => doc.uri.toString() === vscodeUri.toString(),
            );
            if (openDoc) {
              return openDoc.getText();
            }
            return this.fileAccess.readFile(uri);
          },
        },
      );

      this.cache.replaceAll(result.graph, result.implFileToRegistrationIds);
      this.logScanSummary(mode, result.graph, result.errors);
      this.onIndexChangedEmitter.fire(result.graph);
      return result.graph;
    } catch (error) {
      if (signal.aborted) {
        this.log('Scan cancelled');
      } else {
        this.log(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return this.cache.getGraph();
    } finally {
      this.scanInFlight = false;
    }
  }

  private logScanSummary(
    mode: 'full' | 'incremental',
    graph: DiGraph,
    errors: ScanStageError[],
  ): void {
    const factoryCount = graph.registrations.filter((r) => r.isFactory).length;
    const errorCount = graph.issues.filter((i) => i.severity === 'error').length;
    const warningCount = graph.issues.filter((i) => i.severity === 'warning').length;
    this.log(
      `${mode} scan complete: ${graph.registrations.length} registration(s), ${graph.edges.length} edge(s), ${graph.issues.length} issue(s) (${errorCount} error, ${warningCount} warning)` +
        (factoryCount > 0 ? `, ${factoryCount} factory` : '') +
        (this.scopeSource ? ` [scope: ${this.scopeSource}]` : ''),
    );

    for (const error of errors) {
      this.log(`[warn] ${error.stage}: ${error.message}${error.fileUri ? ` (${error.fileUri})` : ''}`);
    }
  }

  private async resolveValidProjectPath(workspaceRoots: string[]): Promise<string | undefined> {
    const configured = this.getConfig().projectPath;
    if (!configured) {
      return undefined;
    }

    const resolved = resolveConfiguredPath(configured, workspaceRoots);
    if (!resolved) {
      this.log(`Configured projectPath is invalid: ${configured}`);
      return undefined;
    }

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(resolved));
      return configured;
    } catch {
      this.log(`Configured projectPath does not exist: ${resolved}`);
      return undefined;
    }
  }

  private getScanOptions() {
    const config = vscode.workspace.getConfiguration('diContainerMapper');
    return createScanOptions({
      includeServiceDescriptorReplace: config.get<boolean>('includeServiceDescriptorReplace', true),
      excludeTestProjects: config.get<boolean>('excludeTestProjects', true),
      enableKeyed: config.get<boolean>('enableKeyed', false),
    });
  }

  private getConfig(): {
    scanOnSave: boolean;
    projectPath: string;
    scanEntireSolution: boolean;
    useRoslyn: boolean;
  } {
    const config = vscode.workspace.getConfiguration('diContainerMapper');
    return {
      scanOnSave: config.get<boolean>('scanOnSave', true),
      projectPath: config.get<string>('projectPath', '').trim(),
      scanEntireSolution: config.get<boolean>('scanEntireSolution', false),
      useRoslyn: config.get<boolean>('useRoslyn', false),
    };
  }

  private notifyScopeMissing(): void {
    if (this.scopeMissingNotified) {
      return;
    }
    this.scopeMissingNotified = true;
    this.log('No project scope found — set diContainerMapper.projectPath');
    this.options.onScopeMissing?.();
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

export function createOutputLogger(channel: vscode.OutputChannel): (message: string) => void {
  return (message: string) => channel.appendLine(`[info] ${message}`);
}

function isUnderScope(filePath: string, scopeRoot: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = scopeRoot.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
  return normalizedFile.startsWith(`${normalizedRoot}/`) || normalizedFile === normalizedRoot;
}