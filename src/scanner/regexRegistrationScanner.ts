import type { IRegistrationScanner, ScanContext, ScanOptions, UriLike } from '../interfaces';
import { computeRegistrationLogicalKey } from '../registration/registrationId';
import type { Lifetime, Registration } from '../types';
import { getLineText, rangeAt } from '../util/position';
import { findRegistrationMatches } from './patterns';
import type { IScannerFileAccess } from './scannerFileAccess';

export class RegexRegistrationScanner implements IRegistrationScanner {
  constructor(private readonly fileAccess: IScannerFileAccess) {}

  async scanFile(ctx: ScanContext, options: ScanOptions): Promise<Registration[]> {
    const scopeRoot = ctx.projectRoot ?? ctx.fileUri.fsPath;
    return parseRegistrationsFromText(ctx.text, ctx.fileUri.toString(), scopeRoot, options);
  }

  async scanWorkspace(scopeRoot: UriLike, options: ScanOptions): Promise<Registration[]> {
    const files = await this.fileAccess.findCsFiles(scopeRoot, {
      excludeTestProjects: options.excludeTestProjects,
    });
    const all: Registration[] = [];

    for (const fileUri of files) {
      const text = await this.fileAccess.readFile(fileUri);
      const registrations = await this.scanFile(
        {
          fileUri,
          text,
          projectRoot: scopeRoot.fsPath,
        },
        options,
      );
      all.push(...registrations);
    }

    return all;
  }
}

export function parseRegistrationsFromText(
  text: string,
  fileUri: string,
  scopeRoot: string,
  options?: Pick<ScanOptions, 'includeServiceDescriptorReplace' | 'enableKeyed'>,
): Registration[] {
  const matches = findRegistrationMatches(text, {
    includeServiceDescriptorReplace: options?.includeServiceDescriptorReplace,
    enableKeyed: options?.enableKeyed,
  });
  const registrations: Registration[] = [];

  for (const match of matches) {
    const lifetime = match.lifetime as Lifetime;
    const implementationType = match.implementationType ?? match.serviceType;
    const range = rangeAt(text, match.startOffset, match.matchText.length);

    registrations.push({
      id: computeRegistrationLogicalKey({
        scopeRoot,
        fileUri,
        serviceType: match.serviceType,
        implementationType,
        lifetime,
        key: match.key,
      }),
      serviceType: match.serviceType,
      implementationType,
      lifetime,
      isTryAdd: match.isTryAdd,
      isFactory: match.isFactory,
      key: match.key,
      location: {
        fileUri,
        range,
        lineText: getLineText(text, range.startLine),
      },
      projectPath: scopeRoot,
    });
  }

  return registrations;
}