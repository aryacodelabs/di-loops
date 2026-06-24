import * as path from 'node:path';
import * as vscode from 'vscode';
import { classifyDiscoveredFile, type DiscoveredFile } from './scopeResolution';

const DISCOVERY_GLOB = '**/*.{sln,csproj,cs}';
const DISCOVERY_EXCLUDE = '**/{bin,obj,node_modules}/**';

export async function discoverWorkspaceFiles(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): Promise<DiscoveredFile[]> {
  const discovered: DiscoveredFile[] = [];

  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, DISCOVERY_GLOB),
      DISCOVERY_EXCLUDE,
    );

    for (const uri of uris) {
      const base = path.basename(uri.fsPath).toLowerCase();
      if (base.endsWith('.cs') && base !== 'program.cs' && base !== 'startup.cs') {
        continue;
      }

      const classified = classifyDiscoveredFile(uri.fsPath, rootPath);
      if (classified) {
        discovered.push(classified);
      }
    }
  }

  return discovered;
}

export function getWorkspaceRoots(workspaceFolders: readonly vscode.WorkspaceFolder[]): string[] {
  return workspaceFolders.map((folder) => folder.uri.fsPath);
}