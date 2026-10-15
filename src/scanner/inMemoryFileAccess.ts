import type { UriLike } from '../interfaces';
import { canonicalFileKey } from '../util/fileKeys';
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
    const rawCandidates = [uri.fsPath, uri.toString()];
    for (const raw of rawCandidates) {
      if (raw && this.files[raw] !== undefined) {
        return this.files[raw];
      }
    }

    const targetKey = canonicalFileKey(uri.toString() || uri.fsPath);
    for (const [key, content] of Object.entries(this.files)) {
      if (canonicalFileKey(key) === targetKey) {
        return content;
      }
    }

    throw new Error(`File not found: ${uri.fsPath}`);
  }
}

function filePathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}