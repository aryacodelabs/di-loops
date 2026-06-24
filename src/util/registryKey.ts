import type { Registration } from '../types';

/** Registry dimension for duplicate detection and keyed lookups. */
export function getRegistrationGroupKey(registration: Registration): string {
  if (registration.key) {
    return `${registration.serviceType}@${registration.key}`;
  }
  return registration.serviceType;
}

export function isKeyedRegistration(registration: Registration): boolean {
  return registration.key !== undefined && registration.key !== '';
}