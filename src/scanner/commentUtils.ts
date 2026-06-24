/**
 * Heuristic C# comment/string awareness for regex scanners (v1).
 * Skips matches whose start offset lies inside a line or block comment.
 */
export function isOffsetInComment(source: string, offset: number): boolean {
  if (offset < 0 || offset >= source.length) {
    return true;
  }

  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inVerbatimString = false;
  let inChar = false;

  while (index < offset) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      index++;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index++;
      continue;
    }

    if (inVerbatimString) {
      if (char === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (char === '"') {
        inVerbatimString = false;
      }
      index++;
      continue;
    }

    if (inString) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index++;
      continue;
    }

    if (inChar) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '\'') {
        inChar = false;
      }
      index++;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === '@' && next === '"') {
      inVerbatimString = true;
      index += 2;
      continue;
    }

    if (char === '"') {
      inString = true;
      index++;
      continue;
    }

    if (char === '\'') {
      inChar = true;
      index++;
      continue;
    }

    index++;
  }

  return inLineComment || inBlockComment;
}