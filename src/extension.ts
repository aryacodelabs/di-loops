import * as vscode from 'vscode';
import { createOutputLogger, IndexManager } from './index/indexManager';
import { RoslynHostManager } from './roslyn/roslynHostManager';
import { UiCoordinator } from './ui/uiCoordinator';

const OUTPUT_CHANNEL_NAME = 'DI-Loops';

let outputChannel: vscode.OutputChannel | undefined;
let indexManager: IndexManager | undefined;
let uiCoordinator: UiCoordinator | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);

  const log = createOutputLogger(outputChannel);
  log('DI-Loops activated');

  const roslynHostManager = new RoslynHostManager(context, log);
  context.subscriptions.push({ dispose: () => void roslynHostManager.dispose() });

  indexManager = new IndexManager({
    log,
    roslynHostManager,
    onScopeMissing: () => {
      void vscode.window.showWarningMessage(
        'DI-Loops: no .NET project scope found. Set diContainerMapper.projectPath in settings.',
      );
    },
  });
  context.subscriptions.push(indexManager);

  uiCoordinator = new UiCoordinator(indexManager, context);
  context.subscriptions.push(uiCoordinator);

  void indexManager.initialize();

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.map', async () => {
      if (!indexManager) {
        return;
      }
      const graph = await indexManager.fullScan();
      showScanSummary(graph);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.refresh', async () => {
      if (!indexManager) {
        return;
      }
      await indexManager.resolveScope();
      const graph = await indexManager.fullScan();
      showScanSummary(graph);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.revealRegistration', async (registrationId: string) => {
      await uiCoordinator?.revealRegistration(registrationId);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.revealIssue', async (issue: import('./types').DiIssue) => {
      await uiCoordinator?.revealIssue(issue);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.showDependencies', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('DI-Loops: open a C# file first.');
        return;
      }
      await uiCoordinator?.showDependenciesForEditor(editor);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diContainerMapper.showGraph', async (item?: unknown) => {
      const registrationId = resolveRegistrationIdFromCommandArg(item);
      if (!registrationId) {
        void vscode.window.showInformationMessage(
          'DI-Loops: select a registration in the DI Registrations tree.',
        );
        return;
      }
      uiCoordinator?.showGraph(registrationId);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isProjectFile(document.uri)) {
        void indexManager?.resolveScope().then(() => indexManager?.fullScan());
        return;
      }
      indexManager?.scheduleIncrementalScan(document);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('diContainerMapper.projectPath') ||
        event.affectsConfiguration('diContainerMapper.scanOnSave') ||
        event.affectsConfiguration('diContainerMapper.scanEntireSolution') ||
        event.affectsConfiguration('diContainerMapper.useRoslyn') ||
        event.affectsConfiguration('diContainerMapper.roslynHostPath') ||
        event.affectsConfiguration('diContainerMapper.includeServiceDescriptorReplace') ||
        event.affectsConfiguration('diContainerMapper.excludeTestProjects') ||
        event.affectsConfiguration('diContainerMapper.enableKeyed')
      ) {
        void indexManager?.resolveScope().then(() => indexManager?.fullScan());
      }
    }),
  );
}

export function deactivate(): void {
  outputChannel?.appendLine('[info] DI-Loops deactivated');
  uiCoordinator?.dispose();
  uiCoordinator = undefined;
  indexManager?.dispose();
  indexManager = undefined;
  outputChannel?.dispose();
  outputChannel = undefined;
}

function showScanSummary(graph: ReturnType<IndexManager['getGraph']>): void {
  const count = graph.registrations.length;
  const errors = graph.issues.filter((i) => i.severity === 'error').length;
  const warnings = graph.issues.filter((i) => i.severity === 'warning').length;
  void vscode.window.showInformationMessage(
    `DI-Loops: ${count} registration${count === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
  );
}

function isProjectFile(uri: vscode.Uri): boolean {
  const name = uri.path.toLowerCase();
  return name.endsWith('.csproj') || name.endsWith('.sln');
}

function resolveRegistrationIdFromCommandArg(item: unknown): string | undefined {
  if (typeof item === 'string') {
    return item;
  }

  if (!item || typeof item !== 'object') {
    return undefined;
  }

  const candidate = item as { kind?: string; registration?: { id?: string } };
  if (candidate.kind === 'registration' && typeof candidate.registration?.id === 'string') {
    return candidate.registration.id;
  }

  return undefined;
}