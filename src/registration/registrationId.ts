/**
 * Stable registration logical keys — survive line shifts on incremental re-scan.
 * @see docs/di-container-mapper-design.md — Registration ID stability
 */

import { createHash } from 'node:crypto';
import type { Lifetime } from '../types';
import { canonicalFileKey } from '../util/fileKeys';

export interface RegistrationLogicalKeyInput {
  scopeRoot: string;
  fileUri: string;
  serviceType: string;
  implementationType: string;
  lifetime: Lifetime;
  key?: string;
}

const KEY_SEPARATOR = '\0';

/**
 * Computes a stable logical key for a registration.
 * Hash of: scopeRoot + fileUri + serviceType + implementationType + lifetime + key?
 */
export function computeRegistrationLogicalKey(input: RegistrationLogicalKeyInput): string {
  const payload = [
    canonicalFileKey(input.scopeRoot),
    canonicalFileKey(input.fileUri),
    input.serviceType,
    input.implementationType,
    input.lifetime,
    input.key ?? '',
  ].join(KEY_SEPARATOR);

  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}