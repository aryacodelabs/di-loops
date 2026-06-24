import { describe, expect, it } from 'vitest';
import { buildRegistryIndex, lookupInRegistry } from '../../src/types/typeMatcher';
import type { Registration } from '../../src/types';

function reg(
  serviceType: string,
  implementationType = serviceType,
  key?: string,
): Registration {
  return {
    id: `${serviceType}-${implementationType}-${key ?? ''}`,
    serviceType,
    implementationType,
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    key,
    location: {
      fileUri: 'file:///test.cs',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    },
  };
}

describe('lookupInRegistry', () => {
  it('resolves exact type matches with high confidence', () => {
    const index = buildRegistryIndex([reg('IFooService', 'FooService')]);
    const result = lookupInRegistry('IFooService', index, {
      fileUri: 'file:///test.cs',
      fileText: '',
      scopeRoot: 'C:/app',
    });

    expect(result.matchKind).toBe('exact');
    expect(result.confidence).toBe('high');
    expect(result.registration?.implementationType).toBe('FooService');
  });

  it('disambiguates simple-name collisions via using directives', () => {
    const index = buildRegistryIndex([
      reg('NamespaceA.IFoo', 'NamespaceA.FooA'),
      reg('NamespaceB.IFoo', 'NamespaceB.FooB'),
    ]);

    const withUsing = lookupInRegistry('IFoo', index, {
      fileUri: 'file:///OrderService.cs',
      fileText: 'using NamespaceA;\npublic class OrderService { }',
      scopeRoot: 'C:/app',
    });

    expect(withUsing.matchKind).toBe('usingResolved');
    expect(withUsing.registration?.serviceType).toBe('NamespaceA.IFoo');

    const ambiguous = lookupInRegistry('IFoo', index, {
      fileUri: 'file:///OrderService.cs',
      fileText: 'public class OrderService { }',
      scopeRoot: 'C:/app',
    });

    expect(ambiguous.matchKind).toBe('ambiguous');
    expect(ambiguous.registration).toBeUndefined();
  });

  it('does not resolve keyed registrations for non-keyed lookups', () => {
    const index = buildRegistryIndex([
      reg('ICache', 'RedisCache', 'primary'),
      reg('ICache', 'MemoryCache'),
    ]);

    const nonKeyed = lookupInRegistry('ICache', index, {
      fileUri: 'file:///test.cs',
      fileText: '',
      scopeRoot: 'C:/app',
    });

    expect(nonKeyed.registration?.implementationType).toBe('MemoryCache');
    expect(nonKeyed.registration?.key).toBeUndefined();
  });

  it('resolves keyed registrations when serviceKey is provided', () => {
    const index = buildRegistryIndex([
      reg('ICache', 'RedisCache', 'primary'),
      reg('ICache', 'MemoryCache'),
    ]);

    const keyed = lookupInRegistry('ICache', index, {
      fileUri: 'file:///test.cs',
      fileText: '',
      scopeRoot: 'C:/app',
      serviceKey: 'primary',
    });

    expect(keyed.matchKind).toBe('exact');
    expect(keyed.registration?.implementationType).toBe('RedisCache');
    expect(keyed.registration?.key).toBe('primary');
  });
});