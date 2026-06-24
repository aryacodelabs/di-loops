import type { DependencyEdge, DiGraph, Registration, ScannerVersion } from '../types';

export function buildGraph(
  registrations: Registration[],
  edges: DependencyEdge[],
  scannerVersion: ScannerVersion,
): Omit<DiGraph, 'issues'> {
  const adjacency = buildAdjacency(edges);
  const transitive = computeTransitiveClosure(adjacency);

  return {
    registrations,
    edges,
    adjacency: recordFromMap(adjacency),
    transitive: recordFromSetMap(transitive),
    indexedAt: Date.now(),
    scannerVersion,
  };
}

export function buildAdjacency(edges: DependencyEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const list = adjacency.get(edge.fromRegistrationId) ?? [];
    list.push(edge.toType);
    adjacency.set(edge.fromRegistrationId, list);
  }

  return adjacency;
}

/** v1: transitive equals direct dependency types per registration (multi-hop deferred). */
export function computeTransitiveClosure(
  adjacency: Map<string, string[]>,
): Map<string, Set<string>> {
  const transitive = new Map<string, Set<string>>();

  for (const [rootId, deps] of adjacency.entries()) {
    transitive.set(rootId, new Set(deps));
  }

  return transitive;
}

function recordFromMap(map: Map<string, string[]>): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const [key, value] of map.entries()) {
    record[key] = value;
  }
  return record;
}

function recordFromSetMap(map: Map<string, Set<string>>): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const [key, value] of map.entries()) {
    record[key] = Array.from(value);
  }
  return record;
}