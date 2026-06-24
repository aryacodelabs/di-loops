import { describe, expect, it } from 'vitest';
import {
  getProjectNameFromPath,
  isTestProjectName,
  isTestProjectPath,
  isUnderTestProject,
} from '../../src/util/projectFilters';

describe('isTestProjectName', () => {
  it('detects common test project naming patterns', () => {
    expect(isTestProjectName('Ziji.Forms.App.UnitTests')).toBe(true);
    expect(isTestProjectName('MyApp.Tests')).toBe(true);
    expect(isTestProjectName('MyApp.Test')).toBe(true);
    expect(isTestProjectName('MyApp.IntegrationTests')).toBe(true);
    expect(isTestProjectName('MyApp.UnitTest')).toBe(true);
  });

  it('does not flag production projects', () => {
    expect(isTestProjectName('Ziji.Forms.App')).toBe(false);
    expect(isTestProjectName('DiMapper.Sample')).toBe(false);
    expect(isTestProjectName('tests')).toBe(false);
  });
});

describe('isTestProjectPath', () => {
  it('matches when any path segment is a test project', () => {
    expect(
      isTestProjectPath('C:/repo/Ziji.Forms.App.UnitTests/Startup.cs'),
    ).toBe(true);
    expect(isTestProjectPath('C:/repo/src/MyApp.Tests/Program.cs')).toBe(true);
  });

  it('returns false for non-test paths', () => {
    expect(isTestProjectPath('C:/repo/Ziji.Forms.App/Program.cs')).toBe(false);
  });
});

describe('isUnderTestProject', () => {
  it('aliases isTestProjectPath', () => {
    const path = 'D:/work/MyApp.UnitTests/Fixtures/Program.cs';
    expect(isUnderTestProject(path)).toBe(isTestProjectPath(path));
  });
});

describe('getProjectNameFromPath', () => {
  it('reads project name from a .csproj segment', () => {
    expect(getProjectNameFromPath('C:/repo/MyApp/MyApp.csproj')).toBe('MyApp');
  });

  it('falls back to parent folder name', () => {
    expect(getProjectNameFromPath('C:/repo/MyApp/Program.cs')).toBe('MyApp');
  });
});