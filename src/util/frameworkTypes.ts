/** Types commonly provided by ASP.NET Core / host without explicit Program.cs registration. */
const FRAMEWORK_TYPE_PREFIXES = [
  'ILogger',
  'IConfiguration',
  'IHostEnvironment',
  'IWebHostEnvironment',
  'IHostApplicationLifetime',
  'IHttpContextAccessor',
  'IOptions',
  'IOptionsSnapshot',
  'IOptionsMonitor',
  'IUrlHelperFactory',
  'LinkGenerator',
];

const FRAMEWORK_SIMPLE_TYPES = new Set([
  'HttpContext',
  'CancellationToken',
  'IFormFile',
  'IActionContextAccessor',
]);

export function isFrameworkProvidedType(typeName: string): boolean {
  const simple = typeName.includes('.') ? typeName.slice(typeName.lastIndexOf('.') + 1) : typeName;
  const genericBase = simple.split('<')[0] ?? simple;

  if (FRAMEWORK_SIMPLE_TYPES.has(simple) || FRAMEWORK_SIMPLE_TYPES.has(genericBase)) {
    return true;
  }

  return FRAMEWORK_TYPE_PREFIXES.some(
    (prefix) => genericBase === prefix || genericBase.startsWith(`${prefix}<`),
  );
}

export function isPrimitiveOrBuiltIn(typeName: string): boolean {
  const simple = typeName.replace(/\?$/, '').split('<')[0] ?? typeName;
  return /^(string|int|long|bool|double|float|decimal|byte|short|char|object|Guid|DateTime|TimeSpan)$/i.test(
    simple,
  );
}