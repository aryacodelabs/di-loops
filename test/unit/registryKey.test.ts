import { describe, expect, it } from 'vitest';
import { getRegistrationGroupKey, isKeyedRegistration } from '../../src/util/registryKey';
import type { Registration } from '../../src/types';

function reg(key?: string): Registration {
  return {
    id: 'id',
    serviceType: 'ICache',
    implementationType: 'RedisCache',
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    key,
    location: {
      fileUri: 'file:///Program.cs',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    },
  };
}

describe('registryKey', () => {
  it('builds group keys with and without service keys', () => {
    expect(getRegistrationGroupKey(reg())).toBe('ICache');
    expect(getRegistrationGroupKey(reg('primary'))).toBe('ICache@primary');
  });

  it('detects keyed registrations', () => {
    expect(isKeyedRegistration(reg())).toBe(false);
    expect(isKeyedRegistration(reg('primary'))).toBe(true);
  });
});