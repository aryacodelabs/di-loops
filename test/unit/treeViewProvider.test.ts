import { describe, expect, it } from 'vitest';
import { getParentNode } from '../../src/ui/treeNodeHierarchy';
import {
  injectionSiteIssues,
  registrationsForGroup,
  visibleTreeGroups,
} from '../../src/ui/treeGrouping';
import type { DiGraph, Registration } from '../../src/types';

function registration(id: string, lifetime: Registration['lifetime'] = 'Singleton'): Registration {
  return {
    id,
    serviceType: 'IService',
    implementationType: 'Service',
    lifetime,
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: 'file:///Program.cs',
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
    },
  };
}

describe('treeNodeHierarchy', () => {
  it('resolves parent chain for tree reveal', () => {
    const reg = registration('a', 'Scoped');
    const regNode = { kind: 'registration' as const, registration: reg, id: 'reg:a' };
    const depNode = {
      kind: 'dependency' as const,
      edge: { fromRegistrationId: 'a', toType: 'IDep', resolution: 'constructor' as const },
      registration: reg,
      id: 'dep:a:IDep',
    };

    const group = getParentNode(regNode);
    expect(group).toEqual({
      kind: 'lifetime-group',
      lifetime: 'Scoped',
      id: 'group:Scoped',
    });
    expect(getParentNode(group!)).toBeUndefined();
    expect(getParentNode(depNode)).toEqual(regNode);
  });

  it('places keyed registrations under the Keyed group', () => {
    const reg = {
      ...registration('keyed', 'Singleton'),
      serviceType: 'ICache',
      implementationType: 'RedisCache',
      key: 'primary',
    };
    const regNode = { kind: 'registration' as const, registration: reg, id: 'reg:keyed' };

    expect(getParentNode(regNode)).toEqual({
      kind: 'lifetime-group',
      lifetime: 'Keyed',
      id: 'group:Keyed',
    });
  });
});

describe('treeGrouping', () => {
  it('groups keyed and non-keyed registrations separately', () => {
    const registrations: Registration[] = [
      {
        ...registration('plain', 'Singleton'),
        serviceType: 'IClock',
        implementationType: 'Clock',
      },
      {
        ...registration('keyed', 'Singleton'),
        serviceType: 'ICache',
        implementationType: 'RedisCache',
        key: 'primary',
      },
    ];

    expect(visibleTreeGroups(registrations, emptyGraph())).toEqual(['Singleton', 'Keyed']);
    expect(registrationsForGroup(registrations, 'Singleton').map((r) => r.serviceType)).toEqual([
      'IClock',
    ]);
    expect(registrationsForGroup(registrations, 'Keyed').map((r) => r.key)).toEqual(['primary']);
  });

  it('shows an Unregistered group when injection-site issues exist', () => {
    const graph: DiGraph = {
      registrations: [registration('svc', 'Scoped')],
      edges: [],
      issues: [
        {
          kind: 'UNREGISTERED',
          code: 'UNREGISTERED_INJECTION',
          severity: 'error',
          message: "HomeController: 'IErrorLogging' is not registered in the DI container",
          relatedType: 'IErrorLogging',
          location: {
            fileUri: 'file:///Controllers/HomeController.cs',
            range: { startLine: 8, startCol: 26, endLine: 8, endCol: 39 },
          },
        },
      ],
      indexedAt: Date.now(),
      scannerVersion: 'regex-v1',
    };

    expect(visibleTreeGroups(graph.registrations, graph)).toContain('Unregistered');
    expect(injectionSiteIssues(graph)).toHaveLength(1);
  });
});

function emptyGraph(): DiGraph {
  return {
    registrations: [],
    edges: [],
    issues: [],
    indexedAt: Date.now(),
    scannerVersion: 'regex-v1',
  };
}