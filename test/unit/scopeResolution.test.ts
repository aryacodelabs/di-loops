import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyDiscoveredFile,
  isAuxiliaryProjectDir,
  resolveScopeRoot,
  type DiscoveredFile,
} from '../../src/index/scopeResolution';

const rootA = 'C:/workspace/repo';
const rootB = 'C:/workspace/other';

function hostEntry(relativePath: string, workspaceRoot = rootA): DiscoveredFile {
  const absolutePath = path.join(workspaceRoot, relativePath);
  const classified = classifyDiscoveredFile(absolutePath, workspaceRoot);
  if (!classified) {
    throw new Error(`Failed to classify ${relativePath}`);
  }
  return classified;
}

describe('resolveScopeRoot', () => {
  it('prefers projectPath config over discovered files', () => {
    const result = resolveScopeRoot({
      projectPathConfig: 'src/MyApp',
      workspaceRoots: [rootA],
      discoveredFiles: [hostEntry('Program.cs')],
    });

    expect(result).toEqual({ scopeRoot: path.join(rootA, 'src/MyApp'), source: 'config' });
  });

  it('selects startup project instead of whole solution by default', () => {
    const result = resolveScopeRoot({
      workspaceRoots: [rootA],
      discoveredFiles: [
        classifyDiscoveredFile(path.join(rootA, 'MySolution.sln'), rootA)!,
        hostEntry('src/Ziji.Components.Demo/Program.cs'),
        hostEntry('src/Ziji.Forms.App/Program.cs'),
      ],
    });

    expect(result?.source).toBe('startupProject');
    expect(result?.scopeRoot).toBe(path.join(rootA, 'src/Ziji.Forms.App'));
  });

  it('can scan the entire solution folder when configured', () => {
    const result = resolveScopeRoot({
      workspaceRoots: [rootA],
      scanEntireSolution: true,
      discoveredFiles: [
        classifyDiscoveredFile(path.join(rootA, 'alpha/Alpha.sln'), rootA)!,
        hostEntry('alpha/Ziji.Forms.App/Program.cs'),
      ],
    });

    expect(result?.source).toBe('sln');
    expect(result?.scopeRoot).toBe(path.join(rootA, 'alpha'));
  });

  it('selects shallowest host entry across roots', () => {
    const result = resolveScopeRoot({
      workspaceRoots: [rootA, rootB],
      discoveredFiles: [
        hostEntry('src/Client/Program.cs', rootA),
        hostEntry('Program.cs', rootB),
      ],
    });

    expect(result?.source).toBe('hostEntry');
    expect(result?.scopeRoot.replace(/\\/g, '/')).toBe(rootB);
  });

  it('falls back to lexicographically first csproj', () => {
    const result = resolveScopeRoot({
      workspaceRoots: [rootA],
      discoveredFiles: [
        classifyDiscoveredFile(path.join(rootA, 'b/B.csproj'), rootA)!,
        classifyDiscoveredFile(path.join(rootA, 'a/A.csproj'), rootA)!,
      ],
    });

    expect(result?.source).toBe('csproj');
    expect(result?.scopeRoot).toBe(path.join(rootA, 'a'));
  });

  it('returns undefined when nothing is discovered', () => {
    expect(resolveScopeRoot({ workspaceRoots: [rootA], discoveredFiles: [] })).toBeUndefined();
  });
});

describe('isAuxiliaryProjectDir', () => {
  it('flags demo and test project folders', () => {
    expect(isAuxiliaryProjectDir('C:/repo/Ziji.Components.Demo')).toBe(true);
    expect(isAuxiliaryProjectDir('C:/repo/Ziji.Forms.App.UnitTests')).toBe(true);
    expect(isAuxiliaryProjectDir('C:/repo/Ziji.Forms.App')).toBe(false);
  });
});