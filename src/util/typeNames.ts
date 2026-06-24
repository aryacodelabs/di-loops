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