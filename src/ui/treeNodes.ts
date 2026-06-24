import type { DependencyEdge, DiIssue, Lifetime, Registration } from '../types';

export type RegistrationTreeGroup = Lifetime | 'Keyed' | 'Unregistered';

export type DiTreeNode =
  | LifetimeGroupNode
  | RegistrationTreeNode
  | DependencyTreeNode
  | UnregisteredInjectionNode;

export interface LifetimeGroupNode {
  kind: 'lifetime-group';
  lifetime: RegistrationTreeGroup;
  id: string;
}

export interface RegistrationTreeNode {
  kind: 'registration';
  registration: Registration;
  id: string;
}

export interface DependencyTreeNode {
  kind: 'dependency';
  edge: DependencyEdge;
  registration: Registration;
  id: string;
}

export interface UnregisteredInjectionNode {
  kind: 'unregistered-injection';
  issue: DiIssue;
  id: string;
}