import * as vscode from 'vscode';
import type { DiGraph } from '../types';

export class DiStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

  constructor() {
    this.item.command = 'diContainerMapper.map';
    this.item.tooltip = 'DI-Loops — click to rescan';
  }

  update(graph: DiGraph): void {
    const errors = graph.issues.filter((i) => i.severity === 'error').length;
    const warnings = graph.issues.filter((i) => i.severity === 'warning').length;
    const factories = graph.registrations.filter((r) => r.isFactory).length;

    let text = `$(database) DI: ${graph.registrations.length} regs`;
    if (errors > 0 || warnings > 0) {
      text += `, ${errors}$(error), ${warnings}$(warning)`;
    }
    if (graph.scannerVersion === 'regex-v1') {
      text += ' (heuristic)';
    } else if (graph.scannerVersion === 'roslyn-v2') {
      text += ' (roslyn)';
    }
    if (factories > 0) {
      text += ` (${factories} factories)`;
    }

    this.item.text = text;
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}