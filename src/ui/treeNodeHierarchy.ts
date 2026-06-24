import type { DiTreeNode } from './treeNodes';

export function getParentNode(element: DiTreeNode): DiTreeNode | undefined {
  if (element.kind === 'lifetime-group' || element.kind === 'unregistered-injection') {
    if (element.kind === 'unregistered-injection') {
      return {
        kind: 'lifetime-group',
        lifetime: 'Unregistered',
        id: 'group:Unregistered',
      };
    }
    return undefined;
  }

  if (element.kind === 'registration') {
    if (element.registration.key) {
      return {
        kind: 'lifetime-group',
        lifetime: 'Keyed',
        id: 'group:Keyed',
      };
    }

    return {
      kind: 'lifetime-group',
      lifetime: element.registration.lifetime,
      id: `group:${element.registration.lifetime}`,
    };
  }

  return {
    kind: 'registration',
    registration: element.registration,
    id: `reg:${element.registration.id}`,
  };
}