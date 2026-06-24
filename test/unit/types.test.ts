import { describe, expect, it } from 'vitest';
import { createEmptyGraph, createEmptyIndexCache } from '../../src/types';

describe('createEmptyGraph', () => {
  it('returns an empty graph with regex-v1 scanner by default', () => {
    const graph = createEmptyGraph();

    expect(graph.registrations).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.issues).toEqual([]);
    expect(graph.scannerVersion).toBe('regex-v1');
    expect(graph.indexedAt).toBeGreaterThan(0);
  });

  it('accepts an explicit scanner version', () => {
    const graph = createEmptyGraph('roslyn-v2');
    expect(graph.scannerVersion).toBe('roslyn-v2');
  });
});

describe('createEmptyIndexCache', () => {
  it('wraps an empty graph with empty lookup maps', () => {
    const cache = createEmptyIndexCache();

    expect(cache.graph.registrations).toEqual([]);
    expect(cache.fileToRegistrationIds.size).toBe(0);
    expect(cache.implFileToRegistrationIds.size).toBe(0);
    expect(cache.version).toBe(0);
  });
});