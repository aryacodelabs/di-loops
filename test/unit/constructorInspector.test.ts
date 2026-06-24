import { describe, expect, it } from 'vitest';
import {
  extractConstructorEdges,
  RegexConstructorInspector,
} from '../../src/constructor/constructorInspector';
import { InMemoryScannerFileAccess } from '../../src/scanner/inMemoryFileAccess';
import type { Registration } from '../../src/types';
import { findConstructors, selectPrimaryConstructor } from '../../src/util/csharp';

const SCOPE = 'C:/projects/MyApp';

function registration(overrides: Partial<Registration> & Pick<Registration, 'id' | 'implementationType'>): Registration {
  return {
    serviceType: overrides.implementationType,
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: 'file:///program.cs',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    },
    ...overrides,
  };
}

describe('findConstructors / selectPrimaryConstructor', () => {
  const multiCtorSource = `
namespace MyApp;

public class MultiCtorService
{
    public MultiCtorService() { }

    public MultiCtorService(IThing thing, IOther other, IThird third)
    {
    }
}
`;

  it('selects the public constructor with the most parameters', () => {
    const candidates = findConstructors('MultiCtorService', multiCtorSource);
    const primary = selectPrimaryConstructor(candidates);

    expect(primary?.parameterTypes).toEqual(['IThing', 'IOther', 'IThird']);
  });
});

describe('extractConstructorEdges', () => {
  const orderServiceSource = `
namespace MyApp;

public class OrderService
{
    public OrderService(IOrderRepository repo, IPaymentGateway gateway, IClock clock) { }
}
`;

  it('extracts constructor parameter types as dependency edges', () => {
    const reg = registration({ id: 'order', implementationType: 'OrderService' });
    const edges = extractConstructorEdges(reg, orderServiceSource);

    expect(edges).toHaveLength(3);
    expect(edges.map((e) => e.toType)).toEqual(['IOrderRepository', 'IPaymentGateway', 'IClock']);
    expect(edges.every((e) => e.resolution === 'constructor')).toBe(true);
    expect(edges.every((e) => e.fromRegistrationId === 'order')).toBe(true);
  });

  it('returns no edges for factory registrations', () => {
    const reg = registration({
      id: 'factory',
      implementationType: 'ReportService',
      isFactory: true,
    });
    const edges = extractConstructorEdges(reg, orderServiceSource);
    expect(edges).toEqual([]);
  });
});

describe('RegexConstructorInspector', () => {
  it('locates implementation files and inspects constructors', async () => {
    const files = {
      'C:/projects/MyApp/OrderService.cs': `
public class OrderService
{
    public OrderService(IOrderRepository repo) { }
}
`,
    };

    const inspector = new RegexConstructorInspector(
      new InMemoryScannerFileAccess(files),
    );

    const results = await inspector.inspect(
      [registration({ id: 'order', implementationType: 'OrderService' })],
      { fsPath: SCOPE, toString: () => SCOPE },
    );

    expect(results).toHaveLength(1);
    expect(results[0].implFileUri).toContain('OrderService.cs');
    expect(results[0].edges).toHaveLength(1);
    expect(results[0].edges[0].toType).toBe('IOrderRepository');
  });
});