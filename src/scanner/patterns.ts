/**
 * DI registration regex patterns — requirements §4.
 * @see docs/di-container-mapper-requirements.md
 */

import { isOffsetInComment } from './commentUtils';

export interface RegistrationPatternMatch {
  lifetime: string;
  serviceType: string;
  implementationType?: string;
  isTryAdd: boolean;
  isFactory: boolean;
  key?: string;
  matchText: string;
  startOffset: number;
}

/** AddSingleton<T>() / AddSingleton<TInterface, TImpl>() */
export const STANDARD_REGISTRATION_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*<\s*([\w.]+)(?:\s*,\s*([\w.]+))?\s*>\s*\(\s*\)/gm;

/** AddSingleton<T>(instance) with a non-lambda argument */
export const INSTANCE_ARG_REGISTRATION_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*<\s*([\w.]+)\s*>\s*\(\s*(?![\w.]+\s*=>)([^)]+)\)/gm;

/** AddSingleton<TInterface, TImpl>(sp => ...) */
export const LAMBDA_PAIR_FACTORY_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*<\s*([\w.]+)\s*,\s*([\w.]+)\s*>\s*\(\s*[\w.]+\s*=>/gm;

/** AddSingleton<T>(sp => new TImpl(...)) */
export const FACTORY_REGISTRATION_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*<\s*([\w.]+)\s*>\s*\(\s*[\w.]+\s*=>\s*new\s+([\w.]+)/gm;

/** AddSingleton<T>(sp => ...) when implementation type is not expressed with `new` */
export const LAMBDA_GENERIC_FACTORY_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*<\s*([\w.]+)\s*>\s*\(\s*[\w.]+\s*=>/gm;

/** AddScoped(sp => new HttpClient { ... }) without an explicit service generic */
export const NON_GENERIC_LAMBDA_FACTORY_PATTERN =
  /\b(TryAdd|Add)(Singleton|Scoped|Transient)\s*\(\s*[\w.]+\s*=>\s*new\s+([\w.]+)/gm;

/** services.Replace(ServiceDescriptor.Scoped<TService, TImpl>()) */
export const SERVICE_DESCRIPTOR_REPLACE_PATTERN =
  /\.Replace\s*\(\s*ServiceDescriptor\.(Singleton|Scoped|Transient)\s*<\s*([\w.]+)(?:\s*,\s*([\w.]+))?\s*>\s*\(\s*\)/gm;

/** AddKeyedSingleton<TService, TImpl>("key") */
export const KEYED_STANDARD_REGISTRATION_PATTERN =
  /\b(TryAdd|Add)Keyed(Singleton|Scoped|Transient)\s*<\s*([\w.]+)(?:\s*,\s*([\w.]+))?\s*>\s*\(\s*(?:"([^"]*)"|'([^']*)'|([\w.]+))\s*(?:,|\))/gm;

/** AddKeyedSingleton<TService, TImpl>("key", (sp, key) => ...) */
export const KEYED_LAMBDA_FACTORY_PATTERN =
  /\b(TryAdd|Add)Keyed(Singleton|Scoped|Transient)\s*<\s*([\w.]+)(?:\s*,\s*([\w.]+))?\s*>\s*\(\s*(?:"([^"]*)"|'([^']*)'|([\w.]+))\s*,\s*(?:\([^)]*\)|[\w.]+)\s*=>/gm;

export interface RegistrationMatchOptions {
  includeServiceDescriptorReplace?: boolean;
  enableKeyed?: boolean;
}

export function findRegistrationMatches(
  text: string,
  options: RegistrationMatchOptions = {},
): RegistrationPatternMatch[] {
  const matches: RegistrationPatternMatch[] = [];

  collectStandardMatches(text, matches);
  collectInstanceArgMatches(text, matches);
  collectLambdaPairFactoryMatches(text, matches);
  collectFactoryMatches(text, matches);
  collectLambdaGenericFactoryMatches(text, matches);
  collectNonGenericLambdaFactoryMatches(text, matches);
  if (options.includeServiceDescriptorReplace !== false) {
    collectServiceDescriptorReplaceMatches(text, matches);
  }
  if (options.enableKeyed === true) {
    collectKeyedLambdaFactoryMatches(text, matches);
    collectKeyedStandardMatches(text, matches);
  }

  return matches.sort((a, b) => a.startOffset - b.startOffset);
}

function collectStandardMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(STANDARD_REGISTRATION_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[4],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: false,
    });
  }
}

function collectInstanceArgMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(INSTANCE_ARG_REGISTRATION_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[3],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: false,
    });
  }
}

function collectLambdaPairFactoryMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(LAMBDA_PAIR_FACTORY_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[4],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: true,
    });
  }
}

function collectFactoryMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(FACTORY_REGISTRATION_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[4],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: true,
    });
  }
}

function collectLambdaGenericFactoryMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(LAMBDA_GENERIC_FACTORY_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[3],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: true,
    });
  }
}

function collectNonGenericLambdaFactoryMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(NON_GENERIC_LAMBDA_FACTORY_PATTERN)) {
    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[3],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: true,
    });
  }
}

function collectKeyedStandardMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(KEYED_STANDARD_REGISTRATION_PATTERN)) {
    const key = extractKeyedServiceKey(match, 5, 6, 7);
    if (!key) {
      continue;
    }

    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[4],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: false,
      key,
    });
  }
}

function collectKeyedLambdaFactoryMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(KEYED_LAMBDA_FACTORY_PATTERN)) {
    const key = extractKeyedServiceKey(match, 5, 6, 7);
    if (!key) {
      continue;
    }

    pushMatch(matches, text, match, {
      lifetime: match[2],
      serviceType: match[3],
      implementationType: match[4] ?? match[3],
      isTryAdd: match[1] === 'TryAdd',
      isFactory: true,
      key,
    });
  }
}

function extractKeyedServiceKey(
  match: RegExpMatchArray,
  stringLiteralGroup: number,
  charLiteralGroup: number,
  identifierGroup: number,
): string | undefined {
  const key =
    match[stringLiteralGroup] ?? match[charLiteralGroup] ?? match[identifierGroup] ?? '';
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function collectServiceDescriptorReplaceMatches(text: string, matches: RegistrationPatternMatch[]): void {
  for (const match of text.matchAll(SERVICE_DESCRIPTOR_REPLACE_PATTERN)) {
    const tokenIndex = match[0].indexOf('Replace');
    const startOffset = (match.index ?? 0) + Math.max(tokenIndex, 0);
    if (isOffsetInComment(text, startOffset)) {
      continue;
    }

    if (matches.some((existing) => existing.startOffset === startOffset)) {
      continue;
    }

    matches.push({
      lifetime: match[1],
      serviceType: match[2],
      implementationType: match[3] ?? match[2],
      isTryAdd: false,
      isFactory: false,
      matchText: text.slice(startOffset, (match.index ?? 0) + match[0].length),
      startOffset,
    });
  }
}

function pushMatch(
  matches: RegistrationPatternMatch[],
  text: string,
  match: RegExpMatchArray,
  payload: Omit<RegistrationPatternMatch, 'matchText' | 'startOffset'>,
): void {
  const { startOffset, matchText } = matchSpan(text, match);
  if (isOffsetInComment(text, startOffset)) {
    return;
  }

  if (matches.some((existing) => existing.startOffset === startOffset)) {
    return;
  }

  matches.push({
    ...payload,
    matchText,
    startOffset,
  });
}

function matchSpan(text: string, match: RegExpMatchArray): { startOffset: number; matchText: string } {
  const prefixToken = match[1];
  const tokenIndex = match[0].indexOf(prefixToken);
  const startOffset = (match.index ?? 0) + Math.max(tokenIndex, 0);
  const endOffset = (match.index ?? 0) + match[0].length;
  return { startOffset, matchText: text.slice(startOffset, endOffset) };
}