/** Returns the unqualified type name: `MyApp.Services.Foo` → `Foo`, `Foo<T>` → `Foo`. */
export function getSimpleTypeName(typeName: string): string {
  const trimmed = typeName.trim();
  const lastDot = trimmed.lastIndexOf('.');
  const simple = lastDot >= 0 ? trimmed.slice(lastDot + 1) : trimmed;
  const genericStart = simple.indexOf('<');
  return genericStart >= 0 ? simple.slice(0, genericStart) : simple;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Computes generic arity (number of type parameters/arguments).
 * Returns 0 for non-generic types (e.g. `Foo`),
 * 1 for single-argument generics (e.g. `LogHelper<T>`, `LogHelper<AccountController>`, `LogHelper<>`),
 * 2 for two-argument generics (e.g. `IRepository<TKey, TVal>`, `IRepository<,>`), etc.
 */
export function getGenericArity(typeName: string): number {
  const genericStart = typeName.indexOf('<');
  if (genericStart === -1) {
    return 0;
  }
  const genericEnd = typeName.lastIndexOf('>');
  if (genericEnd <= genericStart) {
    return 0;
  }
  const inside = typeName.slice(genericStart + 1, genericEnd).trim();
  if (inside.length === 0) {
    return 1;
  }

  if (/^[\s,]+$/.test(inside)) {
    const commaCount = (inside.match(/,/g) || []).length;
    return commaCount + 1;
  }

  let depth = 0;
  let topLevelCommas = 0;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === '<') {
      depth++;
    } else if (ch === '>') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      topLevelCommas++;
    }
  }

  return topLevelCommas + 1;
}

/**
 * Returns true if the type is an open generic representation, e.g. `LogHelper<>` or `IRepository<,>`.
 */
export function isOpenGenericType(typeName: string): boolean {
  const genericStart = typeName.indexOf('<');
  if (genericStart === -1) {
    return false;
  }
  const genericEnd = typeName.lastIndexOf('>');
  if (genericEnd <= genericStart) {
    return false;
  }
  const inside = typeName.slice(genericStart + 1, genericEnd).trim();
  return inside.length === 0 || /^[\s,]+$/.test(inside);
}

/**
 * Converts a generic type to its open generic form:
 * `LogHelper<AccountController>` → `LogHelper<>`
 * `Ziji.Forms.App.LogHelper<AccountController>` → `Ziji.Forms.App.LogHelper<>`
 * `IRepository<Order, int>` → `IRepository<,>`
 * `LogHelper<>` → `LogHelper<>`
 * `NonGeneric` → `NonGeneric`
 */
export function toOpenGenericTypeName(typeName: string): string {
  const arity = getGenericArity(typeName);
  if (arity === 0) {
    return typeName.trim();
  }
  const genericStart = typeName.indexOf('<');
  const base = typeName.slice(0, genericStart).trim();
  const commas = ','.repeat(Math.max(0, arity - 1));
  return `${base}<${commas}>`;
}