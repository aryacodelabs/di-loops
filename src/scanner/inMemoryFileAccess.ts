import type { UriLike } from '../interfaces';
import type { IScannerFileAccess } from './scannerFileAccess';

/** In-memory file access for unit tests. */
export class InMemoryScannerFileAccess implements IScannerFileAccess {
  constructor(private readonly files: Record<string, string>) {}

  async findCsFiles(_scopeRoot: UriLike): Promise<UriLike[]> {
    return Object.keys(this.files)
      .sort()
      .map((filePath) => ({
        fsPath: filePath,
        toString: () => filePathToUri(filePath),
      }));
  }

  async readFile(uri: UriLike): Promise<string> {
    const candidates = [
      uri.fsPath,
      normalizeLookupKey(uri.fsPath),
      uriPathFromUri(uri.toString()),
      normalizeLookupKey(uriPathFromUri(uri.toString())),
    ];

    for (const key of candidates) {
      if (key && this.files[key] !== undefined) {
        return this.files[key];
      }
    }

    throw new Error(`File not found: ${uri.fsPath}`);
  }
}

function normalizeLookupKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^file:\/\/\/?/i, '');
}

function filePathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

function uriPathFromUri(uri: string): string {
  return uri.replace(/^file:\/\/\/?/i, '').replace(/\//g, '\\');
}