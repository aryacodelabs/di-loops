import type { DiGraph, DiIssue, Registration } from '../types';
import type { RegistrationTreeGroup } from './treeNodes';

const LIFETIME_GROUPS: RegistrationTreeGroup[] = ['Singleton', 'Scoped', 'Transient', 'Keyed'];

export function registrationsForGroup(
  registrations: Registration[],
  group: RegistrationTreeGroup,
): Registration[] {
  const filtered =
    group === 'Keyed'
      ? registrations.filter((registration) => registration.key)
      : registrations.filter(
          (registration) => !registration.key && registration.lifetime === group,
        );

  return filtered.sort((a, b) => {
    const serviceCompare = a.serviceType.localeCompare(b.serviceType);
    if (serviceCompare !== 0) {
      return serviceCompare;
    }
    return (a.key ?? '').localeCompare(b.key ?? '');
  });
}

export function isInjectionSiteIssue(issue: DiIssue): boolean {
  return (
    issue.code === 'UNREGISTERED_INJECTION' ||
    (issue.code === 'UNREGISTERED_LOW_CONFIDENCE' && !issue.registrationId)
  );
}

export function injectionSiteIssues(graph: DiGraph): DiIssue[] {
  return graph.issues
    .filter(isInjectionSiteIssue)
    .sort((a, b) => {
      const hostCompare = injectionSiteHostName(a).localeCompare(injectionSiteHostName(b));
      if (hostCompare !== 0) {
        return hostCompare;
      }
      return (a.relatedType ?? '').localeCompare(b.relatedType ?? '');
    });
}

export function injectionSiteHostName(issue: DiIssue): string {
  const match = /^([^:]+):/.exec(issue.message);
  return match?.[1]?.trim() ?? 'Unknown';
}

export function injectionSiteLabel(issue: DiIssue): string {
  return `${injectionSiteHostName(issue)} → ${issue.relatedType ?? 'unknown'}`;
}

export function visibleTreeGroups(
  registrations: Registration[],
  graph: DiGraph,
): RegistrationTreeGroup[] {
  const groups = LIFETIME_GROUPS.filter(
    (group) => registrationsForGroup(registrations, group).length > 0,
  );

  if (injectionSiteIssues(graph).length > 0) {
    groups.push('Unregistered');
  }

  return groups;
}