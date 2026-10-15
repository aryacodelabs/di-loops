import type { IExtensionMethodResolver, ScanOptions, UriLike } from '../interfaces';
import { DEFAULT_SCAN_OPTIONS } from '../scanOptions';
import type { Registration } from '../types';
import { parseRegistrationsFromText } from '../scanner/regexRegistrationScanner';
import type { IScannerFileAccess } from '../scanner/scannerFileAccess';
import {
  extractExtensionMethodBody,
  findExtensionMethodCalls,
} from './extensionMethodPatterns';

const MAX_RESOLVE_DEPTH = 20;

export class RegexExtensionMethodResolver implements IExtensionMethodResolver {
  constructor(
    private readonly fileAccess: IScannerFileAccess,
    private readonly maxDepth: number = MAX_RESOLVE_DEPTH,
  ) {}

  async resolve(
    registrations: Registration[],
    scopeRoot: UriLike,
    signal?: AbortSignal,
    scanOptions: ScanOptions = DEFAULT_SCAN_OPTIONS,
  ): Promise<Registration[]> {
    const byId = new Map<string, Registration>();
    for (const registration of registrations) {
      byId.set(registration.id, registration);
    }

    const files = await this.fileAccess.findCsFiles(scopeRoot, {
      excludeTestProjects: scanOptions.excludeTestProjects,
    });
    const visited = new Set<string>();

    for (const fileUri of files) {
      throwIfAborted(signal);
      const text = await this.fileAccess.readFile(fileUri);
      const calls = findExtensionMethodCalls(text);

      for (const call of calls) {
        throwIfAborted(signal);
        await this.expandMethodCall({
          methodName: call.methodName,
          scopeRoot,
          files,
          byId,
          visited,
          depth: 0,
          signal,
          scanOptions,
        });
      }
    }

    return Array.from(byId.values());
  }

  private async expandMethodCall(context: {
    methodName: string;
    scopeRoot: UriLike;
    files: UriLike[];
    byId: Map<string, Registration>;
    visited: Set<string>;
    depth: number;
    signal?: AbortSignal;
    scanOptions: ScanOptions;
  }): Promise<void> {
    const { methodName, scopeRoot, files, byId, visited, depth, signal, scanOptions } = context;

    if (depth >= this.maxDepth) {
      return;
    }

    const visitKey = `${methodName}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    const methodSource = await this.findMethodBody(methodName, files, signal);
    if (!methodSource) {
      return;
    }

    const nestedRegistrations = parseRegistrationsFromText(
      methodSource.body,
      methodSource.fileUri,
      scopeRoot.fsPath,
      scanOptions,
    );

    for (const registration of nestedRegistrations) {
      byId.set(registration.id, registration);
    }

    const nestedCalls = findExtensionMethodCalls(methodSource.body);
    for (const nested of nestedCalls) {
      throwIfAborted(signal);
      await this.expandMethodCall({
        methodName: nested.methodName,
        scopeRoot,
        files,
        byId,
        visited,
        depth: depth + 1,
        signal,
        scanOptions,
      });
    }
  }

  private async findMethodBody(
    methodName: string,
    files: UriLike[],
    signal?: AbortSignal,
  ): Promise<{ body: string; fileUri: string } | undefined> {
    for (const fileUri of files) {
      throwIfAborted(signal);
      const text = await this.fileAccess.readFile(fileUri);
      const body = extractExtensionMethodBody(text, methodName);
      if (body) {
        return { body, fileUri: fileUri.toString() };
      }
    }

    return undefined;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Extension method resolution aborted');
  }
}