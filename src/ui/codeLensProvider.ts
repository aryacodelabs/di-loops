import * as vscode from 'vscode';
import type { DiGraph } from '../types';
import { createEmptyGraph } from '../types';
import { codeLensSummary } from './issueUtils';

export class DiCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  private graph: DiGraph = createEmptyGraph();

  refresh(graph: DiGraph): void {
    this.graph = graph;
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const fileUri = document.uri.toString();
    const registrations = this.graph.registrations.filter(
      (r) => normalizeUri(r.location.fileUri) === normalizeUri(fileUri),
    );

    return registrations.map((registration) => {
      const range = new vscode.Range(
        registration.location.range.startLine,
        0,
        registration.location.range.startLine,
        0,
      );
      const lens = new vscode.CodeLens(range);
      lens.command = {
        command: 'diContainerMapper.revealRegistration',
        title: codeLensSummary(registration, this.graph),
        arguments: [registration.id],
      };
      return lens;
    });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function normalizeUri(uri: string): string {
  return uri.replace(/\\/g, '/').replace(/^file:\/\/\/?/i, '').toLowerCase();
}