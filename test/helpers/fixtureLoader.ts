import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function loadCsFilesFromDirectory(rootDir: string): Record<string, string> {
  const files: Record<string, string> = {};

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.cs')) {
        files[normalizePath(fullPath)] = readFileSync(fullPath, 'utf8');
      }
    }
  }

  walk(rootDir);
  return files;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function getFixtureRoot(fixtureName: string): string {
  return path.join(__dirname, '..', 'fixtures', fixtureName).replace(/\\/g, '/');
}