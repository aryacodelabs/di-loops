import { describe, expect, it } from 'vitest';
import { buildEgoGraph, pickDefaultFocusRegistration } from '../../src/ui/graphData';
import type { DiGraph, Registration } from '../../src/types';

function registration(
  id: string,
  serviceType: string,
  implementationType: string,
  lifetime: Registration['lifetime'] = 'Singleton',
): Registration {
  return {
    id,
    serviceType,
    implementationType,
    lifetime,
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: `file:///src/${implementationType}.cs`,
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 20 },
    },
  };
}

function graph(
  registrations: Registration[],
  edges: DiGraph['edges'] = [],
  issues: DiGraph['issues'] = [],
): DiGraph {
  return {
    registrations,
    edges,
    issues,
    indexedAt: 0,
    scannerVersion: 'regex-v1',
  };
}

describe('graphData', () => {
  it('builds an ego graph with lifetime colors and mismatch edge labels', () => {
    const host = registration('host', 'IAppHost', 'AppHost', 'Singleton');
    const scoped = registration('scoped', 'IUserContext', 'UserContext', 'Scoped');
    const g = graph(
      [host, scoped],
      [{ fromRegistrationId: 'host', toType: 'IUserContext', resolution: 'constructor' }],
      [
        {
          kind: 'CAPTURED_SCOPED',
          code: 'CAPTURED_SCOPED',
          severity: 'error',
          message: 'captures scoped',
          registrationId: 'host',
          relatedType: 'IUserContext',
        },
      ],
    );

    const payload = buildEgoGraph(g, 'host');
    expect(payload).toBeDefined();
    expect(payload?.focusNodeId).toBe('reg:host');
    expect(payload?.nodes).toHaveLength(2);

    const hostNode = payload?.nodes.find((n) => n.registrationId === 'host');
    expect(hostNode?.color).toBe('#4a90d9');
    expect(hostNode?.border).toBe('#e51400');

    const scopedNode = payload?.nodes.find((n) => n.registrationId === 'scoped');
    expect(scopedNode?.color).toBe('#50c878');

    expect(payload?.edges).toEqual([
      expect.objectContaining({
        from: 'reg:host',
        to: 'reg:scoped',
        color: '#e51400',
        label: 'captured!',
      }),
    ]);
  });

  it('adds unregistered type nodes with issue border', () => {
    const host = registration('host', 'IAppHost', 'AppHost');
    const g = graph(
      [host],
      [{ fromRegistrationId: 'host', toType: 'IMissingService', resolution: 'constructor' }],
    );

    const payload = buildEgoGraph(g, 'host');
    const unregistered = payload?.nodes.find((n) => n.label.includes('IMissingService'));
    expect(unregistered?.color).toBe('#666666');
    expect(unregistered?.border).toBe('#e51400');
    expect(unregistered?.registrationId).toBeUndefined();
  });

  it('annotates keyed registration nodes with @key labels', () => {
    const keyed = {
      ...registration('cache', 'ICache', 'RedisCache', 'Singleton'),
      key: 'primary',
    };
    const g = graph([keyed]);

    const payload = buildEgoGraph(g, 'cache');
    const node = payload?.nodes.find((n) => n.registrationId === 'cache');

    expect(node?.label).toContain('ICache @primary');
    expect(node?.label).toContain('RedisCache');
  });

  it('does not resolve keyed registrations as unkeyed graph targets', () => {
    const host = registration('host', 'IAppHost', 'AppHost');
    const keyedCache = {
      ...registration('cache', 'ICache', 'RedisCache', 'Singleton'),
      key: 'primary',
    };
    const g = graph(
      [host, keyedCache],
      [{ fromRegistrationId: 'host', toType: 'ICache', resolution: 'constructor' }],
    );

    const payload = buildEgoGraph(g, 'host');
    const cacheNode = payload?.nodes.find((n) => n.registrationId === 'cache');
    const unregisteredNode = payload?.nodes.find((n) => n.label.includes('ICache (unregistered)'));

    expect(cacheNode).toBeUndefined();
    expect(unregisteredNode).toBeDefined();
  });

  it('picks a registration with issues as default focus', () => {
    const ok = registration('ok', 'IClock', 'Clock');
    const bad = registration('bad', 'IAppHost', 'AppHost');
    const g = graph(
      [ok, bad],
      [],
      [
        {
          kind: 'TRAPPED_TRANSIENT',
          code: 'TRAPPED_TRANSIENT',
          severity: 'warning',
          message: 'trapped',
          registrationId: 'bad',
          relatedType: 'IClock',
        },
      ],
    );

    expect(pickDefaultFocusRegistration(g)).toBe('bad');
  });
});