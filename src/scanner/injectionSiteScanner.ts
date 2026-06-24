import type { IInjectionSiteScanner, InjectionSiteScanResult, UriLike } from '../interfaces';
import type { InjectionSite, Registration } from '../types';
import {
  findPrimaryConstructorParameters,
  findPublicClassNames,
} from '../util/csharp';
import { isFrameworkProvidedType, isPrimitiveOrBuiltIn } from '../util/frameworkTypes';
import { getLineText } from '../util/position';
import { getSimpleTypeName } from '../util/typeNames';
import type { IScannerFileAccess } from './scannerFileAccess';

export class RegexInjectionSiteScanner implements IInjectionSiteScanner {
  constructor(private readonly fileAccess: IScannerFileAccess) {}

  async scan(
    registrations: Registration[],
    scopeRoot: UriLike,
    signal?: AbortSignal,
  ): Promise<InjectionSiteScanResult> {
    const registeredImplNames = new Set(
      registrations.map((registration) => getSimpleTypeName(registration.implementationType)),
    );

    const sites: InjectionSite[] = [];
    const hostFileTexts: Record<string, string> = {};
    const files = await this.fileAccess.findCsFiles(scopeRoot);

    for (const fileUri of files) {
      throwIfAborted(signal);
      const text = await this.fileAccess.readFile(fileUri);
      const fileUriString = fileUri.toString();
      hostFileTexts[fileUriString] = text;

      for (const className of findPublicClassNames(text)) {
        if (registeredImplNames.has(className)) {
          continue;
        }

        const parameters = findPrimaryConstructorParameters(className, text);
        for (const parameter of parameters) {
          if (
            isFrameworkProvidedType(parameter.typeName) ||
            isPrimitiveOrBuiltIn(parameter.typeName)
          ) {
            continue;
          }

          sites.push({
            hostTypeName: className,
            parameterType: parameter.typeName,
            fileUri: fileUriString,
            range: parameter.range,
            lineText: getLineText(text, parameter.range.startLine),
          });
        }
      }
    }

    return { sites, hostFileTexts };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Scan aborted');
  }
}