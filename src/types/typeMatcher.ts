import type { Registration, RegistryLookupResult } from '../types';
import { getRegistrationGroupKey, isKeyedRegistration } from '../util/registryKey';
import { getSimpleTypeName } from '../util/typeNames';

export interface RegistryIndex {
  byExactType: Map<string, Registration[]>;
  byGroupKey: Map<string, Registration[]>;
  all: Registration[];
}

export interface LookupContext {
  fileUri: string;
  fileText: string;
  scopeRoot: string;
  /** When set, only keyed registrations with this key are eligible. */
  serviceKey?: string;
}

export function buildRegistryIndex(registrations: Registration[]): RegistryIndex {
  const byExactType = new Map<string, Registration[]>();
  const byGroupKey = new Map<string, Registration[]>();

  for (const registration of registrations) {
    const groupKey = getRegistrationGroupKey(registration);
    addToIndex(byGroupKey, groupKey, registration);

    if (isKeyedRegistration(registration)) {
      continue;
    }

    addToIndex(byExactType, registration.serviceType, registration);
    if (registration.implementationType !== registration.serviceType) {
      addToIndex(byExactType, registration.implementationType, registration);
    }
  }

  return { byExactType, byGroupKey, all: registrations };
}

export function lookupInRegistry(
  paramType: string,
  index: RegistryIndex,
  context: LookupContext,
): RegistryLookupResult {
  const eligible = (registration: Registration): boolean =>
    matchesKeyContext(registration, context.serviceKey);

  const exact = index.byExactType.get(paramType)?.filter(eligible);
  if (exact && exact.length > 0) {
    return {
      registration: exact[0],
      confidence: 'high',
      matchKind: 'exact',
    };
  }

  if (context.serviceKey) {
    const keyedExact = index.byGroupKey.get(`${paramType}@${context.serviceKey}`)?.filter(eligible);
    if (keyedExact && keyedExact.length > 0) {
      return {
        registration: keyedExact[0],
        confidence: 'high',
        matchKind: 'exact',
      };
    }
  }

  const paramSimple = getSimpleTypeName(paramType);
  const simpleMatches = index.all.filter(
    (registration) =>
      eligible(registration) &&
      (getSimpleTypeName(registration.serviceType) === paramSimple ||
        getSimpleTypeName(registration.implementationType) === paramSimple),
  );

  if (simpleMatches.length === 1) {
    return {
      registration: simpleMatches[0],
      confidence: 'medium',
      matchKind: 'simpleName',
    };
  }

  if (simpleMatches.length > 1) {
    const usingNamespaces = parseUsingNamespaces(context.fileText);
    const disambiguated = simpleMatches.filter((registration) =>
      namespaceVisibleInFile(getTypeNamespace(registration.serviceType), usingNamespaces),
    );

    if (disambiguated.length === 1) {
      return {
        registration: disambiguated[0],
        confidence: 'medium',
        matchKind: 'usingResolved',
      };
    }

    return {
      confidence: 'low',
      matchKind: 'ambiguous',
    };
  }

  const usingResolved = resolveViaUsingAlias(paramType, index, context.fileText, eligible);
  if (usingResolved) {
    return usingResolved;
  }

  const suffixMatches = index.all.filter(
    (registration) =>
      eligible(registration) &&
      (registration.serviceType.endsWith(`.${paramSimple}`) ||
        registration.implementationType.endsWith(`.${paramSimple}`)),
  );

  if (suffixMatches.length === 1) {
    return {
      registration: suffixMatches[0],
      confidence: 'low',
      matchKind: 'suffix',
    };
  }

  if (suffixMatches.length > 1) {
    return {
      confidence: 'low',
      matchKind: 'ambiguous',
    };
  }

  return {
    confidence: 'low',
    matchKind: 'none',
  };
}

function matchesKeyContext(registration: Registration, requiredKey?: string): boolean {
  if (requiredKey !== undefined) {
    return registration.key === requiredKey;
  }
  return !isKeyedRegistration(registration);
}

function addToIndex(map: Map<string, Registration[]>, key: string, registration: Registration): void {
  const list = map.get(key) ?? [];
  list.push(registration);
  map.set(key, list);
}

function parseUsingNamespaces(fileText: string): Set<string> {
  const namespaces = new Set<string>();

  for (const match of fileText.matchAll(/^\s*using\s+([\w.]+)\s*;/gm)) {
    if (match[1]) {
      namespaces.add(match[1]);
    }
  }

  for (const match of fileText.matchAll(/^\s*using\s+([\w.]+)\s*=\s*([\w.]+)\s*;/gm)) {
    if (match[2]) {
      namespaces.add(match[2]);
    }
  }

  return namespaces;
}

function getTypeNamespace(typeName: string): string | undefined {
  const lastDot = typeName.lastIndexOf('.');
  if (lastDot <= 0) {
    return undefined;
  }
  return typeName.slice(0, lastDot);
}

function namespaceVisibleInFile(namespace: string | undefined, usingNamespaces: Set<string>): boolean {
  if (!namespace) {
    return false;
  }

  for (const usingNs of usingNamespaces) {
    if (namespace === usingNs || namespace.startsWith(`${usingNs}.`)) {
      return true;
    }
  }

  return false;
}

function resolveViaUsingAlias(
  paramType: string,
  index: RegistryIndex,
  fileText: string,
  eligible: (registration: Registration) => boolean,
): RegistryLookupResult | undefined {
  const paramSimple = getSimpleTypeName(paramType);

  for (const usingNs of parseUsingNamespaces(fileText)) {
    const qualified = `${usingNs}.${paramSimple}`;
    const exact = index.byExactType.get(qualified)?.filter(eligible);
    if (exact && exact.length > 0) {
      return {
        registration: exact[0],
        confidence: 'medium',
        matchKind: 'usingResolved',
      };
    }
  }

  return undefined;
}