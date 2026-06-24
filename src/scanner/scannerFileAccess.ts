import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { UriLike } from '../interfaces';
import { shouldSkipDirectoryName } from '../index/scopeResolution';
import { isUnderTestProject } from '../util/projectFilters';

export interface FileDiscoveryOptions {
  excludeTestProjects?: boolean;
}

export interface IScannerFileAccess {
  findCsFiles(scopeRoot: UriLike, options?: FileDiscoveryOptions): Promise<UriLike[]>;
  readFile(uri: UriLike): Promise<string>;
}

export class VsCodeScannerFileAccess implements IScannerFileAccess {
  async findCsFiles(scopeRoot: UriLike, options?: FileDiscoveryOptions): Promise<UriLike[]> {
    const rootUri = vscode.Uri.file(scopeRoot.fsPath);
    const pattern = new vscode.RelativePattern(rootUri, '**/*.cs');
    const exclude = '**/{bin,obj,node_modules}/**';
    const uris = await vscode.workspace.findFiles(pattern, exclude);
    return filterDiscoveredFiles(uris.map(toUriLike), options);
  }

  async readFile(uri: UriLike): Promise<string> {
    const vscodeUri = vscode.Uri.parse(uri.toString());
    const bytes = await vscode.workspace.fs.readFile(vscodeUri);
    return Buffer.from(bytes).toString('utf8');
  }
}

export class NodeScannerFileAccess implements IScannerFileAccess {
  async findCsFiles(scopeRoot: UriLike, options?: FileDiscoveryOptions): Promise<UriLike[]> {
    const files: UriLike[] = [];
    await walkDir(scopeRoot.fsPath, files);
    return filterDiscoveredFiles(files, options).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  async readFile(uri: UriLike): Promise<string> {
    return fs.readFile(uri.fsPath, 'utf8');
  }
}

async function walkDir(dir: string, out: UriLike[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) {
        continue;
      }
      await walkDir(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      const fullPath = path.join(dir, entry.name);
      out.push({ fsPath: fullPath, toString: () => fileUriFromPath(fullPath) });
    }
  }
}

function toUriLike(uri: vscode.Uri): UriLike {
  return { fsPath: uri.fsPath, toString: () => uri.toString() };
}

function filterDiscoveredFiles(files: UriLike[], options?: FileDiscoveryOptions): UriLike[] {
  if (options?.excludeTestProjects === false) {
    return files;
  }

  return files.filter((file) => !isUnderTestProject(file.fsPath));
}

function fileUriFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}