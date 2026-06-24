import type { DiGraph, DiIssue, Registration } from '../types';
import { getRegistrationGroupKey } from '../util/registryKey';
import { formatRegistrationDisplay } from './registrationDisplay';

export function isUnregisteredDependency(
  registrationId: string,
  dependencyType: string,
  graph: DiGraph,
): boolean {
  return graph.issues.some(
    (issue) =>
      issue.registrationId === registrationId &&
      issue.relatedType === dependencyType &&
      (issue.kind === 'UNREGISTERED' || issue.kind === 'UNREGISTERED_LOW_CONFIDENCE'),
  );
}

export function issuesForRegistration(registrationId: string, graph: DiGraph): DiIssue[] {
  return graph.issues.filter(
    (issue) =>
      issue.registrationId === registrationId ||
      (issue.kind === 'DUPLICATE' && issue.relatedType !== undefined),
  );
}

export function worstIssueSeverity(
  registration: Registration,
  graph: DiGraph,
): 'ok' | 'error' | 'warning' {
  const groupKey = getRegistrationGroupKey(registration);
  const related = graph.issues.filter(
    (issue) =>
      issue.registrationId === registration.id ||
      (issue.kind === 'DUPLICATE' && issue.relatedType === groupKey),
  );

  if (related.some((i) => i.severity === 'error')) {
    return 'error';
  }
  if (related.length > 0) {
    return 'warning';
  }
  return 'ok';
}

export function registrationLabel(registration: Registration, _graph: DiGraph): string {
  const base = formatRegistrationDisplay(registration);

  if (registration.isFactory) {
    return `${base} (factory, deps unknown in v1)`;
  }

  return base;
}

export function statusIcon(severity: 'ok' | 'error' | 'warning'): string {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'pass';
  }
}

export function codeLensSummary(registration: Registration, graph: DiGraph): string {
  const edgeCount = graph.edges.filter((e) => e.fromRegistrationId === registration.id).length;
  const relatedIssues = graph.issues.filter((i) => i.registrationId === registration.id);

  if (relatedIssues.length > 0) {
    const top = relatedIssues[0];
    return `$(warning) ${top.message}`;
  }

  if (registration.isFactory) {
    return '$(info) factory registration';
  }

  return `${edgeCount} dependenc${edgeCount === 1 ? 'y' : 'ies'}`;
}