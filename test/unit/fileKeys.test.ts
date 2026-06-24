import { describe, expect, it } from 'vitest';
import { canonicalFileKey } from '../../src/util/fileKeys';
import { mergeRegistrations } from '../../src/index/diIndexCache';
import type { Registration } from '../../src/types';

describe('canonicalFileKey', () => {
  it('normalizes file URI and fsPath to the same key', () => {
    const path = 'd:/repo/program.cs';
    expect(canonicalFileKey(path)).toBe('d:/repo/program.cs');
    expect(canonicalFileKey(`file:///${path}`)).toBe('d:/repo/program.cs');
    expect(canonicalFileKey('file:///d%3A/repo/program.cs')).toBe('d:/repo/program.cs');
  });
});

describe('mergeRegistrations', () => {
  it('drops registrations from a changed file when URI formats differ', () => {
    const existing: Registration[] = [
      {
        id: 'repo',
        serviceType: 'IRepo',
        implementationType: 'Repo',
        lifetime: 'Scoped',
        isTryAdd: false,
        isFactory: false,
        location: {
          fileUri: 'file:///d:/repo/Program.cs',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
        },
      },
    ];

    const merged = mergeRegistrations(
      existing,
      [{ fsPath: 'D:\\repo\\Program.cs', toString: () => 'file:///d:/repo/Program.cs' }],
      [],
    );

    expect(merged).toHaveLength(0);
  });
});