import { describe, expect, it } from 'vitest';
import { DiIndexCacheStore, mergeRegistrations } from '../../src/index/diIndexCache';
import { canonicalFileKey } from '../../src/util/fileKeys';
import type { Registration } from '../../src/types';

function registration(id: string, fileUri: string): Registration {
  return {
    id,
    serviceType: `I${id}`,
    implementationType: id,
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri,
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 10 },
    },
  };
}

describe('mergeRegistrations', () => {
  it('replaces registrations from changed files and retains others', () => {
    const existing = [
      registration('a', 'file:///program.cs'),
      registration('b', 'file:///services.cs'),
    ];
    const delta = [registration('a2', 'file:///program.cs')];

    const merged = mergeRegistrations(existing, ['file:///program.cs'], delta);

    expect(merged.map((r) => r.id)).toEqual(['b', 'a2']);
  });
});

describe('DiIndexCacheStore', () => {
  it('increments version and rebuilds file map on replaceAll', () => {
    const store = new DiIndexCacheStore();
    const regs = [registration('foo', 'file:///program.cs')];

    store.replaceAll({
      registrations: regs,
      edges: [],
      issues: [],
      indexedAt: 1,
      scannerVersion: 'regex-v1',
    });

    const state = store.getState();
    expect(state.version).toBe(1);
    expect(state.fileToRegistrationIds.get(canonicalFileKey('file:///program.cs'))).toEqual(['foo']);
    expect(store.getRegistrations()).toHaveLength(1);
  });
});