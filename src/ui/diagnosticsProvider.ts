import * as vscode from 'vscode';
import type { DiGraph, DiIssue } from '../types';

const DIAGNOSTIC_SOURCE = 'DI-Loops';

export class DiDiagnosticsProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('di-container-mapper');

  update(graph: DiGraph): void {
    this.collection.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const issue of graph.issues) {
      const diagnostic = toDiagnostic(issue);
      const fileUri = issue.location.fileUri;
      const list = byFile.get(fileUri) ?? [];
      list.push(diagnostic);
      byFile.set(fileUri, list);
    }

    for (const [fileUri, diagnostics] of byFile.entries()) {
      this.collection.set(vscode.Uri.parse(fileUri), diagnostics);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toDiagnostic(issue: DiIssue): vscode.Diagnostic {
  const range = new vscode.Range(
    issue.location.range.startLine,
    issue.location.range.startCol,
    issue.location.range.endLine,
    issue.location.range.endCol,
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    issue.message,
    issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = issue.code;
  return diagnostic;
}