import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RoslynScanPaths {
  solutionPath?: string;
  projectPath?: string;
}

export function resolveRoslynScanPaths(scopeRoot: string): RoslynScanPaths {
  const normalizedRoot = path.normalize(scopeRoot);

  const solutionPath = findFirstFile(normalizedRoot, '.sln', 4);
  if (solutionPath) {
    const projectPath = findFirstFile(normalizedRoot, '.csproj', 3);
    return {
      solutionPath,
      projectPath: projectPath ?? normalizedRoot,
    };
  }

  const projectPath = findFirstFile(normalizedRoot, '.csproj', 3);
  if (projectPath) {
    return { projectPath };
  }

  return { projectPath: normalizedRoot };
}

function findFirstFile(root: string, extension: string, maxDepth: number): string | undefined {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const matches: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
        matches.push(path.join(current.dir, entry.name));
      } else if (
        entry.isDirectory() &&
        current.depth < maxDepth &&
        !['bin', 'obj', 'node_modules', '.git'].includes(entry.name.toLowerCase())
      ) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }

  matches.sort((a, b) => a.localeCompare(b));
  return matches[0];
}