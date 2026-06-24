import * as vscode from 'vscode';
import type { DependencyEdge, DiGraph, Registration } from '../types';
import { createEmptyGraph } from '../types';
import {
  isUnregisteredDependency,
  registrationLabel,
  statusIcon,
  worstIssueSeverity,
} from './issueUtils';
import { registrationTreeDescription } from './registrationDisplay';
import { getParentNode } from './treeNodeHierarchy';
import {
  injectionSiteIssues,
  injectionSiteLabel,
  registrationsForGroup,
  visibleTreeGroups,
} from './treeGrouping';
import type { DiTreeNode, RegistrationTreeNode } from './treeNodes';

export type {
  DependencyTreeNode,
  DiTreeNode,
  LifetimeGroupNode,
  RegistrationTreeNode,
  UnregisteredInjectionNode,
} from './treeNodes';

export class DiRegistrationsTreeProvider
  implements vscode.TreeDataProvider<DiTreeNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<DiTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private graph: DiGraph = createEmptyGraph();

  refresh(graph: DiGraph): void {
    this.graph = graph;
    this.emitter.fire();
  }

  getTreeItem(element: DiTreeNode): vscode.TreeItem {
    if (element.kind === 'lifetime-group') {
      const count =
        element.lifetime === 'Unregistered'
          ? injectionSiteIssues(this.graph).length
          : registrationsForGroup(this.graph.registrations, element.lifetime).length;
      const item = new vscode.TreeItem(
        `${element.lifetime} (${count})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      if (element.lifetime === 'Unregistered') {
        item.contextValue = 'unregisteredGroup';
        item.iconPath = new vscode.ThemeIcon('warning');
      } else {
        item.contextValue = element.lifetime === 'Keyed' ? 'keyedGroup' : 'lifetimeGroup';
      }
      return item;
    }

    if (element.kind === 'unregistered-injection') {
      const item = new vscode.TreeItem(
        injectionSiteLabel(element.issue),
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(
        element.issue.severity === 'error' ? 'error' : 'warning',
      );
      item.description = 'unregistered';
      item.contextValue = 'unregisteredInjection';
      item.command = {
        command: 'diContainerMapper.revealIssue',
        title: 'Go to Injection Site',
        arguments: [element.issue],
      };
      return item;
    }

    if (element.kind === 'registration') {
      const severity = worstIssueSeverity(element.registration, this.graph);
      const item = new vscode.TreeItem(
        registrationLabel(element.registration, this.graph),
        this.directEdges(element.registration).length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(statusIcon(severity));
      item.description = registrationTreeDescription(element.registration);
      item.contextValue = element.registration.key ? 'keyedRegistration' : 'registration';
      item.command = {
        command: 'diContainerMapper.revealRegistration',
        title: 'Go to Registration',
        arguments: [element.registration.id],
      };
      return item;
    }

    const unregistered = isUnregisteredDependency(
      element.registration.id,
      element.edge.toType,
      this.graph,
    );
    const item = new vscode.TreeItem(
      element.edge.toType,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = unregistered ? 'unregistered' : element.edge.resolution;
    item.iconPath = new vscode.ThemeIcon(unregistered ? 'warning' : 'link');
    item.contextValue = unregistered ? 'unregisteredDependency' : 'dependency';
    return item;
  }

  getParent(element: DiTreeNode): DiTreeNode | undefined {
    return getParentNode(element);
  }

  getChildren(element?: DiTreeNode): DiTreeNode[] {
    if (!element) {
      return visibleTreeGroups(this.graph.registrations, this.graph).map((group) => ({
        kind: 'lifetime-group' as const,
        lifetime: group,
        id: `group:${group}`,
      }));
    }

    if (element.kind === 'lifetime-group') {
      if (element.lifetime === 'Unregistered') {
        return injectionSiteIssues(this.graph).map((issue, index) => ({
          kind: 'unregistered-injection' as const,
          issue,
          id: `unreg:${index}:${issue.relatedType ?? ''}:${issue.location.fileUri}`,
        }));
      }

      return registrationsForGroup(this.graph.registrations, element.lifetime).map((registration) => ({
        kind: 'registration' as const,
        registration,
        id: `reg:${registration.id}`,
      }));
    }

    if (element.kind === 'registration') {
      return this.directEdges(element.registration).map((edge) => ({
        kind: 'dependency' as const,
        edge,
        registration: element.registration,
        id: `dep:${element.registration.id}:${edge.toType}`,
      }));
    }

    return [];
  }

  findUnregisteredInjectionNode(issue: import('../types').DiIssue) {
    const issues = injectionSiteIssues(this.graph);
    const index = issues.findIndex(
      (candidate) =>
        candidate.relatedType === issue.relatedType &&
        candidate.location.fileUri === issue.location.fileUri &&
        candidate.location.range.startLine === issue.location.range.startLine &&
        candidate.location.range.startCol === issue.location.range.startCol,
    );
    if (index < 0) {
      return undefined;
    }
    return {
      kind: 'unregistered-injection' as const,
      issue: issues[index]!,
      id: `unreg:${index}:${issue.relatedType ?? ''}:${issue.location.fileUri}`,
    };
  }

  findRegistrationNode(registrationId: string): RegistrationTreeNode | undefined {
    const registration = this.graph.registrations.find((r) => r.id === registrationId);
    if (!registration) {
      return undefined;
    }
    return { kind: 'registration', registration, id: `reg:${registration.id}` };
  }

  findRegistrationByTypeName(typeName: string): Registration | undefined {
    const simple = typeName.includes('.') ? typeName.slice(typeName.lastIndexOf('.') + 1) : typeName;
    return this.graph.registrations.find(
      (r) =>
        !r.key &&
        (r.serviceType === typeName ||
          r.implementationType === typeName ||
          r.serviceType.endsWith(`.${simple}`) ||
          r.implementationType.endsWith(`.${simple}`) ||
          r.serviceType === simple ||
          r.implementationType === simple),
    );
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private directEdges(registration: Registration): DependencyEdge[] {
    return this.graph.edges.filter((e) => e.fromRegistrationId === registration.id);
  }
}