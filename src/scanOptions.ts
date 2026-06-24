import type { ScanOptions } from './interfaces';

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  includeServiceDescriptorReplace: true,
  excludeTestProjects: true,
  enableKeyed: false,
};

export function createScanOptions(overrides?: Partial<ScanOptions>): ScanOptions {
  return {
    ...DEFAULT_SCAN_OPTIONS,
    ...overrides,
  };
}