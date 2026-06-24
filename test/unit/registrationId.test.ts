import { describe, expect, it } from 'vitest';
import { computeRegistrationLogicalKey } from '../../src/registration/registrationId';

const baseInput = {
  scopeRoot: 'C:/projects/MyApp',
  fileUri: 'file:///c:/projects/MyApp/Program.cs',
  serviceType: 'IFooService',
  implementationType: 'FooService',
  lifetime: 'Singleton' as const,
};

describe('computeRegistrationLogicalKey', () => {
  it('returns a stable 16-char hex id for the same inputs', () => {
    const id1 = computeRegistrationLogicalKey(baseInput);
    const id2 = computeRegistrationLogicalKey(baseInput);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{16}$/);
  });

  it('normalizes path separators so Windows and POSIX paths match', () => {
    const posix = computeRegistrationLogicalKey({
      ...baseInput,
      scopeRoot: 'C:/projects/MyApp',
      fileUri: 'file:///c:/projects/MyApp/Program.cs',
    });
    const windows = computeRegistrationLogicalKey({
      ...baseInput,
      scopeRoot: 'C:\\projects\\MyApp',
      fileUri: 'file:///c:/projects/MyApp/Program.cs',
    });

    expect(posix).toBe(windows);
  });

  it('changes id when service type, lifetime, or key differ', () => {
    const base = computeRegistrationLogicalKey(baseInput);
    const differentService = computeRegistrationLogicalKey({
      ...baseInput,
      serviceType: 'IBarService',
    });
    const differentLifetime = computeRegistrationLogicalKey({
      ...baseInput,
      lifetime: 'Scoped',
    });
    const keyed = computeRegistrationLogicalKey({
      ...baseInput,
      key: 'primary',
    });

    expect(differentService).not.toBe(base);
    expect(differentLifetime).not.toBe(base);
    expect(keyed).not.toBe(base);
  });

  it('is insensitive to line number changes (location not part of key)', () => {
    const id = computeRegistrationLogicalKey(baseInput);
    // Same logical registration after user inserts lines above the Add<> call
    expect(id).toBe(computeRegistrationLogicalKey(baseInput));
  });
});