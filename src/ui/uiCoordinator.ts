import * as vscode from 'vscode';
import type { IndexManager } from '../index/indexManager';
import type { DiIssue, Registration } from '../types';
import { DiCodeLensProvider } from './codeLensProvider';
import { DiDiagnosticsProvider } from './diagnosticsProvider';
import { DiRegistrationsTreeProvider, type DiTreeNode } from './treeViewProvider';
import { DiStatusBar } from './statusBar';
import { GraphWebviewPanel } from './graphWebviewPanel';

export class UiCoordinator implements vscode.Disposable {
  readonly treeProvider = new DiRegistrationsTreeProvider();
  readonly treeView: vscode.TreeView<DiTreeNode>;
  readonly codeLensProvider = new DiCodeLensProvider();
  readonly diagnosticsProvider = new DiDiagnosticsProvider();
  readonly statusBar = new DiStatusBar();
  readonly graphPanel: GraphWebviewPanel;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly indexManager: IndexManager,
    context: vscode.ExtensionContext,
  ) {
    this.graphPanel = new GraphWebviewPanel(context, (registrationId) =>
      this.revealRegistration(registrationId),
    );
    this.treeView = vscode.window.createTreeView('diContainerMapper.registrations', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });

    this.disposables.push(
      this.treeView,
      indexManager.onIndexChanged((graph) => this.refresh(graph)),
      vscode.languages.registerCodeLensProvider({ language: 'csharp', scheme: 'file' }, this.codeLensProvider),
      this.treeProvider,
      this.codeLensProvider,
      this.diagnosticsProvider,
      this.statusBar,
      this.graphPanel,
    );

    this.refresh(indexManager.getGraph());
  }

  async revealIssue(issue: DiIssue): Promise<void> {
    await openSourceLocation(issue.location.fileUri, issue.location.range);

    const node = this.treeProvider.findUnregisteredInjectionNode(issue);
    if (node) {
      try {
        await this.treeView.reveal(node, { select: true, expand: true });
      } catch {
        // Navigation already opened the source file; tree sync is best-effort.
      }
    }
  }

  async revealRegistration(registrationId: string): Promise<void> {
    const registration = this.indexManager.getGraph().registrations.find((r) => r.id === registrationId);
    if (registration) {
      await openRegistration(registration);
    }

    const node = this.treeProvider.findRegistrationNode(registrationId);
    if (node) {
      try {
        await this.treeView.reveal(node, { select: true, expand: true });
      } catch {
        // Navigation already opened the source file; tree sync is best-effort.
      }
    }
  }

  async showDependenciesForEditor(editor: vscode.TextEditor): Promise<void> {
    const typeName = await resolveTypeAtCaret(editor);
    if (!typeName) {
      void vscode.window.showInformationMessage('DI-Loops: no class/record found at caret.');
      return;
    }

    const registration = this.treeProvider.findRegistrationByTypeName(typeName);
    if (!registration) {
      void vscode.window.showInformationMessage(
        `DI-Loops: '${typeName}' is not in the DI registry.`,
      );
      return;
    }

    if (isWebviewEnabled()) {
      this.graphPanel.show(this.indexManager.getGraph(), registration.id);
      return;
    }

    await this.revealRegistration(registration.id);
  }

  showGraph(registrationId: string): void {
    this.graphPanel.show(this.indexManager.getGraph(), registrationId);
  }

  private refresh(graph: ReturnType<IndexManager['getGraph']>): void {
    this.treeProvider.refresh(graph);
    this.codeLensProvider.refresh(graph);
    this.diagnosticsProvider.update(graph);
    this.statusBar.update(graph);
    this.graphPanel.refresh(graph);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

async function openRegistration(registration: Registration): Promise<void> {
  await openSourceLocation(registration.location.fileUri, registration.location.range);
}

async function openSourceLocation(
  fileUri: string,
  sourceRange: Registration['location']['range'],
): Promise<void> {
  const uri = vscode.Uri.parse(fileUri);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const range = new vscode.Range(
    sourceRange.startLine,
    sourceRange.startCol,
    sourceRange.endLine,
    sourceRange.endCol,
  );
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function resolveTypeAtCaret(editor: vscode.TextEditor): Promise<string | undefined> {
  const position = editor.selection.active;
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    editor.document.uri,
  );

  if (!symbols) {
    return undefined;
  }

  const match = findEnclosingSymbol(symbols, position);
  return match?.name;
}

function findEnclosingSymbol(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position,
): vscode.DocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (!symbol.range.contains(position)) {
      continue;
    }
    const child = findEnclosingSymbol(symbol.children, position);
    return child ?? symbol;
  }
  return undefined;
}

function isWebviewEnabled(): boolean {
  return vscode.workspace.getConfiguration('diContainerMapper').get<boolean>('enableWebview', true);
}