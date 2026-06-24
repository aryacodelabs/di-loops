import type { SourceRange } from '../types';
import { escapeRegExp } from './typeNames';
import { rangeAt } from './position';

/** Extracts the substring inside balanced `{ ... }` starting at openBraceIndex. */
export function extractBalancedBlock(text: string, openBraceIndex: number): string | undefined {
  if (text[openBraceIndex] !== '{') {
    return undefined;
  }

  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    }
  }

  return undefined;
}

/** Splits a C# parameter list on commas, respecting generic angle brackets. */
export function splitParameterList(paramsText: string): string[] {
  const params: string[] = [];
  let current = '';
  let angleDepth = 0;

  for (const ch of paramsText) {
    if (ch === '<') {
      angleDepth++;
      current += ch;
    } else if (ch === '>') {
      angleDepth = Math.max(0, angleDepth - 1);
      current += ch;
    } else if (ch === ',' && angleDepth === 0) {
      if (current.trim()) {
        params.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    params.push(current.trim());
  }

  return params;
}

/** Extracts the type from a parameter declaration such as `IFooService foo` or `string? name`. */
export function extractParameterType(parameterDeclaration: string): string | undefined {
  const trimmed = parameterDeclaration.trim();
  if (!trimmed) {
    return undefined;
  }

  const withoutDefault = trimmed.split('=')[0]?.trim() ?? trimmed;
  const match = /^((?:[\w.]+(?:<[^>]+>)?|\w+\?)(?:\[\])?)\s+[\w@]+$/.exec(withoutDefault);
  return match?.[1];
}

export interface ConstructorCandidate {
  parameterTypes: string[];
  sourceOrder: number;
}

export interface ConstructorParameterInfo {
  typeName: string;
  parameterName: string;
  range: SourceRange;
}

const PUBLIC_CLASS_PATTERN =
  /\bpublic\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*class\s+([A-Za-z_][\w]*)\b/g;

export function findPublicClassNames(fileText: string): string[] {
  const names = new Set<string>();
  for (const match of fileText.matchAll(PUBLIC_CLASS_PATTERN)) {
    if (match[1]) {
      names.add(match[1]);
    }
  }
  return [...names];
}

export function findPrimaryConstructorParameters(
  typeName: string,
  fileText: string,
): ConstructorParameterInfo[] {
  const candidates = findConstructors(typeName, fileText);
  const primary = selectPrimaryConstructor(candidates);
  if (!primary) {
    return [];
  }

  const ctorMatch = findPrimaryConstructorMatch(typeName, fileText);
  if (!ctorMatch) {
    return primary.parameterTypes.map((type) => ({
      typeName: type,
      parameterName: '',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    }));
  }

  return parseParametersWithOffsets(ctorMatch.paramsText, ctorMatch.paramsStartOffset, fileText);
}

export function findConstructors(typeName: string, fileText: string): ConstructorCandidate[] {
  const simpleName = typeName.includes('.') ? typeName.slice(typeName.lastIndexOf('.') + 1) : typeName;
  const escaped = escapeRegExp(simpleName.split('<')[0] ?? simpleName);
  const candidates: ConstructorCandidate[] = [];
  let sourceOrder = 0;

  const primaryPattern = new RegExp(
    `\\b(?:public|internal|private|protected)?\\s*(?:sealed\\s+|abstract\\s+|static\\s+)*(?:class|record)\\s+${escaped}\\s*\\(([^)]*)\\)`,
    'g',
  );

  for (const match of fileText.matchAll(primaryPattern)) {
    const params = match[1] ?? '';
    candidates.push({
      parameterTypes: parseParameterTypes(params),
      sourceOrder: sourceOrder++,
    });
  }

  const typeDeclPattern = new RegExp(
    `\\b(?:public|internal|private|protected)?\\s*(?:sealed\\s+|abstract\\s+|static\\s+)*(?:class|record)\\s+${escaped}\\b`,
  );
  const typeMatch = typeDeclPattern.exec(fileText);
  if (!typeMatch) {
    return candidates;
  }

  const braceStart = findTypeBodyBraceStart(fileText, typeMatch.index + typeMatch[0].length);
  if (braceStart === undefined) {
    return candidates;
  }

  const body = extractBalancedBlock(fileText, braceStart);
  if (!body) {
    return candidates;
  }

  const ctorPattern = new RegExp(
    `\\bpublic\\s+${escaped}\\s*\\(([^)]*)\\)`,
    'g',
  );

  for (const match of body.matchAll(ctorPattern)) {
    const params = match[1] ?? '';
    candidates.push({
      parameterTypes: parseParameterTypes(params),
      sourceOrder: sourceOrder++,
    });
  }

  return candidates;
}

export function hasTypeDeclaration(fileText: string, simpleTypeName: string): boolean {
  const escaped = escapeRegExp(simpleTypeName);
  const pattern = new RegExp(
    `\\b(?:public|internal|private|protected)?\\s*(?:sealed\\s+|abstract\\s+|static\\s+)*(?:class|record|struct)\\s+${escaped}\\b`,
  );
  return pattern.test(fileText);
}

export function selectPrimaryConstructor(candidates: ConstructorCandidate[]): ConstructorCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((best, current) => {
    if (current.parameterTypes.length > best.parameterTypes.length) {
      return current;
    }
    if (current.parameterTypes.length === best.parameterTypes.length && current.sourceOrder < best.sourceOrder) {
      return current;
    }
    return best;
  });
}

function parseParameterTypes(paramsText: string): string[] {
  return splitParameterList(paramsText)
    .map(extractParameterType)
    .filter((type): type is string => Boolean(type));
}

function findPrimaryConstructorMatch(
  typeName: string,
  fileText: string,
): { paramsText: string; paramsStartOffset: number } | undefined {
  const simpleName = typeName.includes('.') ? typeName.slice(typeName.lastIndexOf('.') + 1) : typeName;
  const escaped = escapeRegExp(simpleName.split('<')[0] ?? simpleName);

  const primaryPattern = new RegExp(
    `\\bpublic\\s+(?:sealed\\s+|abstract\\s+|static\\s+)*(?:class|record)\\s+${escaped}\\s*\\(([^)]*)\\)`,
  );
  const primaryMatch = primaryPattern.exec(fileText);
  if (primaryMatch?.index !== undefined) {
    const openParen = fileText.indexOf('(', primaryMatch.index);
    if (openParen >= 0) {
      return {
        paramsText: primaryMatch[1] ?? '',
        paramsStartOffset: openParen + 1,
      };
    }
  }

  const typeDeclPattern = new RegExp(
    `\\bpublic\\s+(?:sealed\\s+|abstract\\s+|static\\s+)*(?:class|record)\\s+${escaped}\\b`,
  );
  const typeMatch = typeDeclPattern.exec(fileText);
  if (!typeMatch) {
    return undefined;
  }

  const braceStart = findTypeBodyBraceStart(fileText, typeMatch.index + typeMatch[0].length);
  if (braceStart === undefined) {
    return undefined;
  }

  const body = extractBalancedBlock(fileText, braceStart);
  if (!body) {
    return undefined;
  }

  const ctorPattern = new RegExp(`\\bpublic\\s+${escaped}\\s*\\(([^)]*)\\)`);
  const ctorMatch = ctorPattern.exec(body);
  if (!ctorMatch || ctorMatch.index === undefined) {
    return undefined;
  }

  const openParen = body.indexOf('(', ctorMatch.index);
  if (openParen < 0) {
    return undefined;
  }

  return {
    paramsText: ctorMatch[1] ?? '',
    paramsStartOffset: braceStart + 1 + openParen + 1,
  };
}

function parseParametersWithOffsets(
  paramsText: string,
  paramsStartOffset: number,
  fileText: string,
): ConstructorParameterInfo[] {
  const parameters: ConstructorParameterInfo[] = [];
  let searchFrom = 0;

  for (const declaration of splitParameterList(paramsText)) {
    const declOffset = paramsText.indexOf(declaration, searchFrom);
    if (declOffset < 0) {
      continue;
    }
    searchFrom = declOffset + declaration.length;

    const typeName = extractParameterType(declaration);
    if (!typeName) {
      continue;
    }

    const typeOffsetInDecl = declaration.indexOf(typeName);
    const typeStartOffset = paramsStartOffset + declOffset + Math.max(typeOffsetInDecl, 0);
    const nameMatch = /\s+([A-Za-z_][\w@]*)$/.exec(declaration.trim());
    const parameterName = nameMatch?.[1] ?? '';

    parameters.push({
      typeName,
      parameterName,
      range: rangeAt(fileText, typeStartOffset, typeName.length),
    });
  }

  return parameters;
}

function findTypeBodyBraceStart(text: string, searchFrom: number): number | undefined {
  const slice = text.slice(searchFrom);
  const classBodyMatch = /\{/.exec(slice);
  if (!classBodyMatch || classBodyMatch.index === undefined) {
    return undefined;
  }
  return searchFrom + classBodyMatch.index;
}