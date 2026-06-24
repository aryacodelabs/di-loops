import { describe, expect, it } from 'vitest';
import { codeLensSummary, worstIssueSeverity } from '../../src/ui/issueUtils';
import type { DiGraph, Registration } from '../../src/types';

function registration(id: string, serviceType: string): Registration {
  return {
    id,
    serviceType,
    implementationType: serviceType.replace(/^I/, ''),
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: 'file:///Program.cs',
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
    },
  };
}

function graph(registrations: Registration[], issues: DiGraph['issues'], edges: DiGraph['edges'] = []): DiGraph {
  return {
    registrations,
    edges,
    issues,
    indexedAt: 0,
    scannerVersion: 'regex-v1',
  };
}

describe('issueUtils', () => {
  it('reports worst severity for registrations with errors', () => {
    const reg = registration('a', 'IAppHost');
    const g = graph(
      [reg],
      [
        {
          kind: 'CAPTURED_SCOPED',
          code: 'CAPTURED_SCOPED',
          severity: 'error',
          message: 'captures scoped',
          registrationId: 'a',
          location: reg.location,
        },
      ],
    );

    expect(worstIssueSeverity(reg, g)).toBe('error');
    expect(codeLensSummary(reg, g)).toContain('captures scoped');
  });

  it('flags duplicate warnings only for matching keyed group keys', () => {
    const keyed = {
      ...registration('cache1', 'ICache'),
      key: 'primary',
      implementationType: 'RedisCache',
    };
    const g = graph(
      [keyed],
      [
        {
          kind: 'DUPLICATE',
          code: 'DUPLICATE',
          severity: 'warning',
          message: "Duplicate registration for 'ICache@secondary'",
          registrationId: 'other',
          relatedType: 'ICache@secondary',
          location: keyed.location,
        },
      ],
    );

    expect(worstIssueSeverity(keyed, g)).toBe('ok');
  });

  it('shows dependency count when no issues exist', () => {
    const reg = registration('b', 'IFoo');
    const g = graph(
      [reg],
      [],
      [{ fromRegistrationId: 'b', toType: 'IBar', resolution: 'constructor' }],
    );

    expect(worstIssueSeverity(reg, g)).toBe('ok');
    expect(codeLensSummary(reg, g)).toBe('1 dependency');
  });
});