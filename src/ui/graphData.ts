import { buildRegistryIndex } from '../types/typeMatcher';
import type { DiGraph, Lifetime, Registration } from '../types';
import { isKeyedRegistration } from '../util/registryKey';
import { getSimpleTypeName } from '../util/typeNames';
import { formatRegistrationDisplay } from './registrationDisplay';
import { worstIssueSeverity } from './issueUtils';

export interface GraphNodePayload {
  id: string;
  label: string;
  color: string;
  border?: string;
  registrationId?: string;
  fileUri?: string;
  range?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
}

export interface GraphEdgePayload {
  from: string;
  to: string;
  color?: string;
  label?: string;
  dashes?: boolean;
}

export interface GraphPayload {
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  focusNodeId: string;
}

const LIFETIME_COLORS: Record<Lifetime, string> = {
  Singleton: '#4a90d9',
  Scoped: '#50c878',
  Transient: '#ff8c00',
};

const ISSUE_BORDER = '#e51400';
const MISMATCH_EDGE = '#e51400';
const DEFAULT_EDGE = '#888888';

export function buildEgoGraph(
  graph: DiGraph,
  focusRegistrationId: string,
  depth = 2,
): GraphPayload | undefined {
  const focus = graph.registrations.find((r) => r.id === focusRegistrationId);
  if (!focus) {
    return undefined;
  }

  const index = buildRegistryIndex(graph.registrations);
  const nodes = new Map<string, GraphNodePayload>();
  const edges: GraphEdgePayload[] = [];
  const visitedRegs = new Set<string>([focusRegistrationId]);
  let frontier = [focusRegistrationId];

  addRegistrationNode(nodes, focus, graph);

  for (let level = 0; level < depth; level++) {
    const nextFrontier: string[] = [];

    for (const registrationId of frontier) {
      const registration = graph.registrations.find((r) => r.id === registrationId);
      if (!registration) {
        continue;
      }

      const outgoing = graph.edges.filter((e) => e.fromRegistrationId === registrationId);
      for (const edge of outgoing) {
        const targetNodeId = resolveTargetNodeId(edge.toType, graph, index, nodes);
        edges.push(buildEdgePayload(registrationId, targetNodeId, edge.toType, graph));

        const targetRegId = targetNodeId.startsWith('reg:') ? targetNodeId.slice(4) : undefined;
        if (targetRegId && !visitedRegs.has(targetRegId)) {
          visitedRegs.add(targetRegId);
          nextFrontier.push(targetRegId);
        }
      }
    }

    frontier = nextFrontier;
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    focusNodeId: registrationNodeId(focusRegistrationId),
  };
}

export function pickDefaultFocusRegistration(graph: DiGraph): string | undefined {
  const withIssues = graph.registrations.filter(
    (r) => worstIssueSeverity(r, graph) !== 'ok',
  );
  if (withIssues.length > 0) {
    return withIssues[0].id;
  }
  return graph.registrations[0]?.id;
}

function resolveTargetNodeId(
  toType: string,
  graph: DiGraph,
  index: ReturnType<typeof buildRegistryIndex>,
  nodes: Map<string, GraphNodePayload>,
): string {
  const registration = findRegistrationForType(toType, index);
  if (registration) {
    addRegistrationNode(nodes, registration, graph);
    return registrationNodeId(registration.id);
  }

  const typeNodeId = typeNodeIdFor(toType);
  if (!nodes.has(typeNodeId)) {
    nodes.set(typeNodeId, {
      id: typeNodeId,
      label: `${toType} (unregistered)`,
      color: '#666666',
      border: ISSUE_BORDER,
    });
  }
  return typeNodeId;
}

function addRegistrationNode(
  nodes: Map<string, GraphNodePayload>,
  registration: Registration,
  graph: DiGraph,
): void {
  const id = registrationNodeId(registration.id);
  if (nodes.has(id)) {
    return;
  }

  const severity = worstIssueSeverity(registration, graph);
  const label = formatRegistrationDisplay(registration).replace(' → ', '\n→ ');

  nodes.set(id, {
    id,
    label,
    color: LIFETIME_COLORS[registration.lifetime],
    border: severity !== 'ok' ? ISSUE_BORDER : undefined,
    registrationId: registration.id,
    fileUri: registration.location.fileUri,
    range: registration.location.range,
  });
}

function buildEdgePayload(
  fromRegistrationId: string,
  toNodeId: string,
  toType: string,
  graph: DiGraph,
): GraphEdgePayload {
  const fromId = registrationNodeId(fromRegistrationId);
  const mismatch = graph.issues.find(
    (issue) =>
      issue.registrationId === fromRegistrationId &&
      issue.relatedType === toType &&
      (issue.kind === 'CAPTURED_SCOPED' || issue.kind === 'TRAPPED_TRANSIENT'),
  );

  if (mismatch?.kind === 'CAPTURED_SCOPED') {
    return { from: fromId, to: toNodeId, color: MISMATCH_EDGE, label: 'captured!' };
  }

  if (mismatch?.kind === 'TRAPPED_TRANSIENT') {
    return { from: fromId, to: toNodeId, color: MISMATCH_EDGE, label: 'trapped' };
  }

  return { from: fromId, to: toNodeId, color: DEFAULT_EDGE };
}

function registrationNodeId(registrationId: string): string {
  return `reg:${registrationId}`;
}

function typeNodeIdFor(typeName: string): string {
  return `type:${typeName}`;
}

function findRegistrationForType(
  toType: string,
  index: ReturnType<typeof buildRegistryIndex>,
): Registration | undefined {
  const exact = index.byExactType.get(toType);
  if (exact && exact.length > 0) {
    return exact[0];
  }

  const simple = getSimpleTypeName(toType);
  return index.all.find(
    (registration) =>
      !isKeyedRegistration(registration) &&
      (getSimpleTypeName(registration.serviceType) === simple ||
        getSimpleTypeName(registration.implementationType) === simple),
  );
}