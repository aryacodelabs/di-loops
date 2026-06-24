/**
 * Patterns for DI extension-method indirection (e.g. services.AddApplicationServices()).
 */

import { isOffsetInComment } from '../scanner/commentUtils';
import { extractBalancedBlock } from '../util/csharp';

export interface ExtensionMethodCall {
  methodName: string;
  startOffset: number;
}

const LIFETIME_SUFFIXES = ['Singleton', 'Scoped', 'Transient', 'Keyed'];

/** Matches `.AddApplicationServices()` but not `.AddSingleton<>()` / `.TryAddScoped<>()`. */
export const EXTENSION_METHOD_CALL_PATTERN =
  /\.((?:TryAdd|Add)(?!Singleton|Scoped|Transient|Keyed)[A-Z][\w]*)\s*\(\s*\)/g;

export function findExtensionMethodCalls(text: string): ExtensionMethodCall[] {
  const calls: ExtensionMethodCall[] = [];

  for (const match of text.matchAll(EXTENSION_METHOD_CALL_PATTERN)) {
    const methodName = match[1];
    if (!methodName || isLifetimeMethod(methodName)) {
      continue;
    }

    const tokenIndex = match[0].indexOf(methodName);
    const startOffset = (match.index ?? 0) + Math.max(tokenIndex, 0);
    if (isOffsetInComment(text, startOffset)) {
      continue;
    }
    calls.push({ methodName, startOffset });
  }

  return calls;
}

export function buildExtensionMethodDefinitionPattern(methodName: string): RegExp {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\bvoid\\s+${escaped}\\s*\\(\\s*this\\s+IServiceCollection\\b[^)]*\\)\\s*\\{`,
    'm',
  );
}

/** Extracts an extension method body from a source file, if present. */
export function extractExtensionMethodBody(fileText: string, methodName: string): string | undefined {
  const pattern = buildExtensionMethodDefinitionPattern(methodName);
  const match = pattern.exec(fileText);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const braceStart = match.index + match[0].lastIndexOf('{');
  if (braceStart < 0 || fileText[braceStart] !== '{') {
    return undefined;
  }

  return extractBalancedBlock(fileText, braceStart);
}

function isLifetimeMethod(methodName: string): boolean {
  return LIFETIME_SUFFIXES.some((suffix) => methodName === `Add${suffix}` || methodName === `TryAdd${suffix}`);
}