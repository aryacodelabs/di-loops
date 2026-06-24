import type { DiGraph, DiIndexCache, Registration } from '../types';
import { createEmptyGraph } from '../types';
import { canonicalFileKey } from '../util/fileKeys';
import type { UriLike } from '../interfaces';

export function mergeRegistrations(
  existing: Registration[],
  changedFiles: Array<string | UriLike>,
  delta: Registration[],
): Registration[] {
  const changed = new Set<string>();
  for (const entry of changedFiles) {
    if (typeof entry === 'string') {
      changed.add(canonicalFileKey(entry));
      continue;
    }
    changed.add(canonicalFileKey(entry.toString()));
    changed.add(canonicalFileKey(entry.fsPath));
  }

  const retained = existing.filter((r) => !changed.has(canonicalFileKey(r.location.fileUri)));
  return [...retained, ...delta];
}

export function buildFileToRegistrationIds(registrations: Registration[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const registration of registrations) {
    const key = canonicalFileKey(registration.location.fileUri);
    const ids = map.get(key) ?? [];
    ids.push(registration.id);
    map.set(key, ids);
  }
  return map;
}

export class DiIndexCacheStore {
  private state: DiIndexCache;

  constructor() {
    this.state = {
      graph: createEmptyGraph(),
      fileToRegistrationIds: new Map(),
      implFileToRegistrationIds: new Map(),
      version: 0,
    };
  }

  getState(): Readonly<DiIndexCache> {
    return this.state;
  }

  getGraph(): DiGraph {
    return this.state.graph;
  }

  getRegistrations(): Registration[] {
    return this.state.graph.registrations;
  }

  replaceAll(graph: DiGraph, implFileToRegistrationIds?: Record<string, string[]>): void {
    const implMap = new Map<string, string[]>();
    if (implFileToRegistrationIds) {
      for (const [fileUri, ids] of Object.entries(implFileToRegistrationIds)) {
        implMap.set(canonicalFileKey(fileUri), ids);
      }
    }

    this.state = {
      graph,
      fileToRegistrationIds: buildFileToRegistrationIds(graph.registrations),
      implFileToRegistrationIds: implMap,
      version: this.state.version + 1,
    };
  }

  replaceGraph(graph: DiGraph): void {
    this.replaceAll(graph);
  }

  mergeRegistrationDelta(changedFileUris: string[], delta: Registration[]): Registration[] {
    return mergeRegistrations(this.state.graph.registrations, changedFileUris, delta);
  }
}

