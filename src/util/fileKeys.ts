/** Canonical key for matching registration file URIs across fsPath / file:// variants. */
export function canonicalFileKey(uriOrPath: string): string {
  let value = uriOrPath.trim();
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(value.replace(/^file:\/\//i, ''));
    } catch {
      value = value.replace(/^file:\/\//i, '');
    }
  }

  if (/^\/[a-zA-Z]:\//i.test(value)) {
    value = value.slice(1);
  }

  return value.replace(/\\/g, '/').toLowerCase();
}