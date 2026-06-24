import type { SourceRange } from '../types';

export function positionAt(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length - 1, col: lines[lines.length - 1]?.length ?? 0 };
}

export function rangeAt(text: string, startOffset: number, length: number): SourceRange {
  const start = positionAt(text, startOffset);
  const end = positionAt(text, startOffset + length);
  return {
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
  };
}

export function getLineText(text: string, line: number): string {
  const lines = text.split(/\r?\n/);
  return lines[line] ?? '';
}