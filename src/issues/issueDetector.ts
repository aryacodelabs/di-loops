import { buildRegistryIndex, lookupInRegistry } from '../types/typeMatcher';
import type { DependencyEdge, DiGraph, DiIssue, InjectionSite, Registration } from '../types';
import { isFrameworkProvidedType, isPrimitiveOrBuiltIn } from '../util/frameworkTypes';
import { getRegistrationGroupKey } from '../util/registryKey';

export function detectIssues(graph: DiGraph): DiIssue[] {
  const issues: DiIssue[] = [];
  const index = buildRegistryIndex(graph.registrations);
  const registrationById = new Map(graph.registrations.map((r) => [r.id, r]));
  const context = graph.detectionContext ?? {
    implFileTexts: {},
    implFileUris: {},
    scopeRoot: '',
    injectionSites: [],
  };

  issues.push(...detectDuplicateRegistrations(graph.registrations));
  issues.push(
    ...detectEdgeIssues(graph.edges, registrationById, index, context),
  );
  issues.push(
    ...detectInjectionSiteIssues(context.injectionSites ?? [], graph.registrations, index, context),
  );

  return dedupeIssues(issues);
}

function detectDuplicateRegistrations(registrations: Registration[]): DiIssue[] {
  const grouped = new Map<string, Registration[]>();

  for (const registration of registrations) {
    if (registration.isTryAdd) {
      continue;
    }
    const groupKey = getRegistrationGroupKey(registration);
    const list = grouped.get(groupKey) ?? [];
    list.push(registration);
    grouped.set(groupKey, list);
  }

  const issues: DiIssue[] = [];

  for (const [groupKey, group] of grouped.entries()) {
    if (group.length <= 1) {
      continue;
    }

    for (const registration of group) {
      issues.push({
        kind: 'DUPLICATE',
        code: 'DUPLICATE',
        severity: 'warning',
        message: `Duplicate registration for '${groupKey}'`,
        registrationId: registration.id,
        relatedType: groupKey,
        location: registration.location,
      });
    }
  }

  return issues;
}

function detectEdgeIssues(
  edges: DependencyEdge[],
  registrationById: Map<string, Registration>,
  index: ReturnType<typeof buildRegistryIndex>,
  context: {
    implFileTexts: Record<string, string>;
    implFileUris: Record<string, string>;
    scopeRoot: string;
  },
): DiIssue[] {
  const issues: DiIssue[] = [];

  for (const edge of edges) {
    const fromRegistration = registrationById.get(edge.fromRegistrationId);
    if (!fromRegistration) {
      continue;
    }

    const implFileText = context.implFileTexts[fromRegistration.id] ?? '';
    const lookupFileUri =
      context.implFileUris[fromRegistration.id] ?? fromRegistration.location.fileUri;
    const lookup = lookupInRegistry(edge.toType, index, {
      fileUri: lookupFileUri,
      fileText: implFileText,
      scopeRoot: context.scopeRoot,
    });

    if (!lookup.registration) {
      issues.push(createUnregisteredIssue(fromRegistration, edge.toType, lookup));
      continue;
    }

    issues.push(...detectLifetimeMismatch(fromRegistration, lookup.registration, edge.toType));
  }

  return issues;
}

function detectLifetimeMismatch(
  fromRegistration: Registration,
  toRegistration: Registration,
  dependencyType: string,
): DiIssue[] {
  if (fromRegistration.lifetime !== 'Singleton') {
    return [];
  }

  if (toRegistration.lifetime === 'Scoped') {
    return [
      {
        kind: 'CAPTURED_SCOPED',
        code: 'CAPTURED_SCOPED',
        severity: 'error',
        message: `Singleton '${fromRegistration.implementationType}' captures scoped dependency '${dependencyType}'`,
        registrationId: fromRegistration.id,
        relatedType: dependencyType,
        location: fromRegistration.location,
      },
    ];
  }

  if (toRegistration.lifetime === 'Transient') {
    return [
      {
        kind: 'TRAPPED_TRANSIENT',
        code: 'TRAPPED_TRANSIENT',
        severity: 'warning',
        message: `Singleton '${fromRegistration.implementationType}' traps transient dependency '${dependencyType}'`,
        registrationId: fromRegistration.id,
        relatedType: dependencyType,
        location: fromRegistration.location,
      },
    ];
  }

  return [];
}

function detectInjectionSiteIssues(
  sites: InjectionSite[],
  registrations: Registration[],
  index: ReturnType<typeof buildRegistryIndex>,
  context: {
    implFileTexts: Record<string, string>;
    implFileUris: Record<string, string>;
    hostFileTexts?: Record<string, string>;
    scopeRoot: string;
  },
): DiIssue[] {
  const issues: DiIssue[] = [];

  for (const site of sites) {
    if (isFrameworkProvidedType(site.parameterType) || isPrimitiveOrBuiltIn(site.parameterType)) {
      continue;
    }

    const lookup = lookupInRegistry(site.parameterType, index, {
      fileUri: site.fileUri,
      fileText: context.hostFileTexts?.[site.fileUri] ?? '',
      scopeRoot: context.scopeRoot,
    });

    if (lookup.registration) {
      continue;
    }

    const location = {
      fileUri: site.fileUri,
      range: site.range,
      lineText: site.lineText,
    };

    if (lookup.matchKind === 'ambiguous') {
      issues.push({
        kind: 'UNREGISTERED_LOW_CONFIDENCE',
        code: 'UNREGISTERED_LOW_CONFIDENCE',
        severity: 'warning',
        message: `${site.hostTypeName}: possible unregistered injection '${site.parameterType}' (ambiguous type match)`,
        relatedType: site.parameterType,
        location,
        matchConfidence: 'low',
        matchKind: lookup.matchKind,
      });
      continue;
    }

    if (lookup.matchKind === 'suffix') {
      issues.push({
        kind: 'UNREGISTERED_LOW_CONFIDENCE',
        code: 'UNREGISTERED_LOW_CONFIDENCE',
        severity: 'warning',
        message: `${site.hostTypeName}: possible unregistered injection '${site.parameterType}' (low confidence)`,
        relatedType: site.parameterType,
        location,
        matchConfidence: 'low',
        matchKind: lookup.matchKind,
      });
      continue;
    }

    issues.push({
      kind: 'UNREGISTERED',
      code: 'UNREGISTERED_INJECTION',
      severity: 'error',
      message: `${site.hostTypeName}: '${site.parameterType}' is not registered in the DI container`,
      relatedType: site.parameterType,
      location,
      matchConfidence: lookup.matchKind === 'none' ? 'low' : undefined,
      matchKind: lookup.matchKind,
    });
  }

  return issues;
}

function dedupeIssues(issues: DiIssue[]): DiIssue[] {
  const seen = new Set<string>();
  const deduped: DiIssue[] = [];

  for (const issue of issues) {
    const location = issue.location;
    const key = [
      issue.kind,
      issue.registrationId ?? '',
      issue.relatedType ?? '',
      location.fileUri,
      location.range.startLine,
      location.range.startCol,
    ].join('\0');

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function createUnregisteredIssue(
  fromRegistration: Registration,
  dependencyType: string,
  lookup: ReturnType<typeof lookupInRegistry>,
): DiIssue {
  const isLowConfidence =
    lookup.matchKind === 'ambiguous' ||
    lookup.matchKind === 'suffix' ||
    lookup.matchKind === 'none';

  if (isLowConfidence && lookup.matchKind === 'ambiguous') {
    return {
      kind: 'UNREGISTERED_LOW_CONFIDENCE',
      code: 'UNREGISTERED_LOW_CONFIDENCE',
      severity: 'warning',
      message: `Possible unregistered dependency '${dependencyType}' (ambiguous type match)`,
      registrationId: fromRegistration.id,
      relatedType: dependencyType,
      location: fromRegistration.location,
      matchConfidence: 'low',
      matchKind: lookup.matchKind,
    };
  }

  if (lookup.matchKind === 'suffix') {
    return {
      kind: 'UNREGISTERED_LOW_CONFIDENCE',
      code: 'UNREGISTERED_LOW_CONFIDENCE',
      severity: 'warning',
      message: `Possible unregistered dependency '${dependencyType}' (low confidence)`,
      registrationId: fromRegistration.id,
      relatedType: dependencyType,
      location: fromRegistration.location,
      matchConfidence: 'low',
      matchKind: lookup.matchKind,
    };
  }

  return {
    kind: 'UNREGISTERED',
    code: 'UNREGISTERED',
    severity: 'error',
    message: `Unregistered dependency '${dependencyType}'`,
    registrationId: fromRegistration.id,
    relatedType: dependencyType,
    location: fromRegistration.location,
    matchConfidence: lookup.matchKind === 'none' ? 'low' : undefined,
    matchKind: lookup.matchKind,
  };
}

