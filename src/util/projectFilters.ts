import * as path from 'node:path';

/** True when a project folder name looks like a unit/integration test project. */
export function isTestProjectName(projectName: string): boolean {
  const name = projectName.toLowerCase();
  return (
    name.includes('unittest') ||
    name.endsWith('.tests') ||
    name.endsWith('.test') ||
    (name.endsWith('tests') && name !== 'tests')
  );
}

/** True when any path segment is a test project folder (e.g. Ziji.Forms.App.UnitTests). */
export function isTestProjectPath(filePath: string): boolean {
  const segments = filePath.replace(/\\/g, '/').split('/');
  return segments.some((segment) => isTestProjectName(segment));
}

export function isUnderTestProject(filePath: string): boolean {
  return isTestProjectPath(filePath);
}

export function getProjectNameFromPath(filePath: string): string {
  const segments = filePath.replace(/\\/g, '/').split('/');
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment.toLowerCase().endsWith('.csproj')) {
      return path.basename(segment, '.csproj');
    }
  }

  return path.basename(path.dirname(filePath));
}