import type { Lifetime, ScanStageError } from '../types';

export const ROSLYN_PROTOCOL_VERSION = 1;

export type RoslynCommand = 'ping' | 'scan' | 'shutdown';

export interface RoslynRequest {
  protocolVersion: typeof ROSLYN_PROTOCOL_VERSION;
  id: string;
  cmd: RoslynCommand;
  payload: Record<string, unknown>;
}

export interface RoslynErrorDto {
  code: string;
  message: string;
  filePath?: string | null;
  fatal?: boolean;
}

export interface RoslynResponse {
  protocolVersion: typeof ROSLYN_PROTOCOL_VERSION;
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: RoslynErrorDto;
}

export interface PingResultDto {
  hostVersion: string;
  roslynVersion: string;
  rid: string;
}

export interface RegistrationDto {
  serviceTypeFqName: string;
  implementationTypeFqName: string;
  lifetime: Lifetime;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
  isTryAdd: boolean;
  isFactory: boolean;
  key?: string | null;
}

export interface ConstructorDepDto {
  implFqName: string;
  paramFqName: string;
  filePath: string;
  line: number;
}

export interface FactoryDepDto {
  registrationFqName: string;
  resolvedFqName: string;
  filePath: string;
  line: number;
}

export interface ScanResultDto {
  registrations: RegistrationDto[];
  constructorDeps: ConstructorDepDto[];
  factoryDeps: FactoryDepDto[];
  errors: RoslynErrorDto[];
}

export function createRequest(
  id: string,
  cmd: RoslynCommand,
  payload: Record<string, unknown> = {},
): RoslynRequest {
  return {
    protocolVersion: ROSLYN_PROTOCOL_VERSION,
    id,
    cmd,
    payload,
  };
}

export function serializeRequest(request: RoslynRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function parseResponseLine(line: string): RoslynResponse | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as RoslynResponse;
    if (parsed.protocolVersion !== ROSLYN_PROTOCOL_VERSION || typeof parsed.id !== 'string') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function parsePingResult(payload: Record<string, unknown> | undefined): PingResultDto | undefined {
  if (!payload || typeof payload.hostVersion !== 'string') {
    return undefined;
  }
  return {
    hostVersion: payload.hostVersion,
    roslynVersion: typeof payload.roslynVersion === 'string' ? payload.roslynVersion : 'unknown',
    rid: typeof payload.rid === 'string' ? payload.rid : 'unknown',
  };
}

export function parseScanResult(payload: Record<string, unknown> | undefined): ScanResultDto | undefined {
  if (!payload || !Array.isArray(payload.registrations)) {
    return undefined;
  }

  return {
    registrations: payload.registrations as RegistrationDto[],
    constructorDeps: Array.isArray(payload.constructorDeps)
      ? (payload.constructorDeps as ConstructorDepDto[])
      : [],
    factoryDeps: Array.isArray(payload.factoryDeps) ? (payload.factoryDeps as FactoryDepDto[]) : [],
    errors: Array.isArray(payload.errors) ? (payload.errors as RoslynErrorDto[]) : [],
  };
}

export function hasFatalScanErrors(errors: RoslynErrorDto[]): boolean {
  return errors.some((error) => error.fatal === true);
}

export function mapRoslynErrors(errors: RoslynErrorDto[]): ScanStageError[] {
  return errors.map((error) => ({
    stage: 'scanner' as const,
    fileUri: error.filePath ?? undefined,
    message: `${error.code}: ${error.message}`,
  }));
}