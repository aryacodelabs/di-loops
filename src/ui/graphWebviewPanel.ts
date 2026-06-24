import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { DiGraph } from '../types';
import { buildEgoGraph, pickDefaultFocusRegistration, type GraphPayload } from './graphData';
import { parseNavigateMessage } from './navigateMessage';

export class GraphWebviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private lastFocusId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onNavigateToRegistration?: (registrationId: string) => void | Promise<void>,
  ) {}

  show(graph: DiGraph, focusRegistrationId?: string): void {
    if (!this.isEnabled()) {
      void vscode.window.showInformationMessage(
        'DI-Loops: webview graph is disabled (diContainerMapper.enableWebview).',
      );
      return;
    }

    const focusId = focusRegistrationId ?? pickDefaultFocusRegistration(graph);
    if (!focusId) {
      void vscode.window.showInformationMessage('DI-Loops: no registrations to graph.');
      return;
    }

    const payload = buildEgoGraph(graph, focusId);
    if (!payload) {
      void vscode.window.showInformationMessage('DI-Loops: registration not found in graph.');
      return;
    }

    this.lastFocusId = focusId;
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'diContainerMapper.graph',
        'DI Dependency Graph',
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      });
    }

    this.panel.title = `DI Graph — ${payload.nodes.find((n) => n.registrationId === focusId)?.label ?? focusId}`;
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.reveal(column);
    void this.postGraph(payload);
  }

  refresh(graph: DiGraph): void {
    if (!this.panel) {
      return;
    }

    const focusId = this.lastFocusId ?? pickDefaultFocusRegistration(graph);
    if (!focusId) {
      return;
    }

    const payload = buildEgoGraph(graph, focusId);
    if (payload) {
      void this.postGraph(payload);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('diContainerMapper').get<boolean>('enableWebview', true);
  }

  private async postGraph(payload: GraphPayload): Promise<void> {
    await this.panel?.webview.postMessage({ type: 'update', data: payload });
  }

  private async handleMessage(message: unknown): Promise<void> {
    const navigate = parseNavigateMessage(message);
    if (!navigate) {
      return;
    }

    if (navigate.registrationId) {
      await this.onNavigateToRegistration?.(navigate.registrationId);
      return;
    }

    if (!navigate.fileUri || !navigate.range) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(navigate.fileUri);
      if (!vscode.workspace.getWorkspaceFolder(uri)) {
        return;
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const range = new vscode.Range(
        navigate.range.startLine,
        navigate.range.startCol,
        navigate.range.endLine,
        navigate.range.endCol,
      );
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      void vscode.window.showErrorMessage('DI-Loops: could not open registration location.');
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const visNetworkJs = webview.asWebviewUri(vscode.Uri.joinPath(media, 'vis-network.bundle.js'));
    const visNetworkCss = webview.asWebviewUri(vscode.Uri.joinPath(media, 'vis-network.bundle.css'));
    const graphCss = webview.asWebviewUri(vscode.Uri.joinPath(media, 'graph.css'));
    const graphJs = webview.asWebviewUri(vscode.Uri.joinPath(media, 'graph.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${visNetworkCss}" />
  <link rel="stylesheet" href="${graphCss}" />
  <title>DI Dependency Graph</title>
</head>
<body>
  <div id="graph"></div>
  <script nonce="${nonce}" src="${visNetworkJs}"></script>
  <script nonce="${nonce}" src="${graphJs}"></script>
</body>
</html>`;
  }
}