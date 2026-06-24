import type { ConstructorInspectResult, IConstructorInspector, UriLike } from '../interfaces';
import type { DependencyEdge, Registration } from '../types';
import { findConstructors, hasTypeDeclaration, selectPrimaryConstructor } from '../util/csharp';
import { getSimpleTypeName } from '../util/typeNames';
import type { IScannerFileAccess } from '../scanner/scannerFileAccess';

export class RegexConstructorInspector implements IConstructorInspector {
  constructor(private readonly fileAccess: IScannerFileAccess) {}

  async inspect(
    registrations: Registration[],
    scopeRoot: UriLike,
    _signal?: AbortSignal,
  ): Promise<ConstructorInspectResult[]> {
    const results: ConstructorInspectResult[] = [];

    for (const registration of registrations) {
      if (registration.isFactory) {
        results.push({
          registrationId: registration.id,
          implementationType: registration.implementationType,
          edges: [],
        });
        continue;
      }

      const implFileUri = await this.locateImplFile(registration.implementationType, scopeRoot);
      if (!implFileUri) {
        results.push({
          registrationId: registration.id,
          implementationType: registration.implementationType,
          edges: [],
        });
        continue;
      }

      const uriLike: UriLike = { fsPath: implFileUri, toString: () => implFileUri };
      const fileText = await this.fileAccess.readFile(uriLike);
      const edges = extractConstructorEdges(registration, fileText);

      results.push({
        registrationId: registration.id,
        implementationType: registration.implementationType,
        implFileUri,
        implFileText: fileText,
        edges,
      });
    }

    return results;
  }

  async locateImplFile(implementationType: string, scopeRoot: UriLike): Promise<string | undefined> {
    const simpleName = getSimpleTypeName(implementationType);
    const files = await this.fileAccess.findCsFiles(scopeRoot);

    for (const fileUri of files) {
      const text = await this.fileAccess.readFile(fileUri);
      if (hasTypeDeclaration(text, simpleName)) {
        return fileUri.fsPath;
      }
    }

    return undefined;
  }
}

export function extractConstructorEdges(
  registration: Registration,
  fileText: string,
): DependencyEdge[] {
  const simpleName = getSimpleTypeName(registration.implementationType);
  const candidates = findConstructors(simpleName, fileText);
  const primary = selectPrimaryConstructor(candidates);

  if (!primary) {
    return [];
  }

  return primary.parameterTypes.map((parameterType) => ({
    fromRegistrationId: registration.id,
    toType: parameterType,
    resolution: 'constructor' as const,
  }));
}