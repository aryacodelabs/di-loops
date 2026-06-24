import { describe, expect, it } from 'vitest';
import {
  formatRegistrationDisplay,
  formatServiceTypeLabel,
  registrationTreeDescription,
} from '../../src/ui/registrationDisplay';
import type { Registration } from '../../src/types';

function registration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 'id',
    serviceType: 'ICache',
    implementationType: 'RedisCache',
    lifetime: 'Singleton',
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: 'file:///Program.cs',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    },
    ...overrides,
  };
}

describe('registrationDisplay', () => {
  it('formats keyed service labels with @key suffix', () => {
    expect(formatServiceTypeLabel('ICache', 'primary')).toBe('ICache @primary');
    expect(formatRegistrationDisplay(registration({ key: 'primary' }))).toBe(
      'ICache @primary → RedisCache',
    );
  });

  it('uses @key description for keyed tree items', () => {
    expect(registrationTreeDescription(registration({ key: 'primary' }))).toBe('@primary');
    expect(registrationTreeDescription(registration({ isTryAdd: true }))).toBe('TryAdd');
  });
});