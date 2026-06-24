import type { Registration } from '../types';
import { isKeyedRegistration } from '../util/registryKey';

export function formatServiceTypeLabel(serviceType: string, key?: string): string {
  if (key) {
    return `${serviceType} @${key}`;
  }
  return serviceType;
}

export function formatRegistrationDisplay(registration: Registration): string {
  const serviceLabel = formatServiceTypeLabel(registration.serviceType, registration.key);

  if (registration.serviceType === registration.implementationType) {
    return serviceLabel;
  }

  return `${serviceLabel} → ${registration.implementationType}`;
}

export function registrationTreeDescription(registration: Registration): string | undefined {
  if (isKeyedRegistration(registration)) {
    return `@${registration.key}`;
  }
  if (registration.isTryAdd) {
    return 'TryAdd';
  }
  return undefined;
}