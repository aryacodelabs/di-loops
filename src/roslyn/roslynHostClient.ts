import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { IRoslynHostClient, RoslynScanRequest, RoslynScanResult } from '../interfaces';
import { mapScanResultDto } from './mapScanResult';
import {
  createRequest,
  hasFatalScanErrors,
  mapRoslynErrors,
  parsePingResult,
  parseResponseLine,
  parseScanResult,
  serializeRequest,
  type RoslynResponse,
} from './protocol';

const PING_TIMEOUT_MS = 5_000;
const SCAN_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

export interface RoslynHostClientOptions {
  hostPath: string;
  expectedHostVersion?: string;
  log?: (message: string) => void;
}

export class RoslynHostClient implements IRoslynHostClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<
    string,
    {
      resolve: (response: RoslynResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private requestQueue: Promise<void> = Promise.resolve();
  private healthy = false;

  constructor(private readonly options: RoslynHostClientOptions) {}

  async ping(): Promise<boolean> {
    try {
      await this.ensureProcess();
      const response = await this.sendCommand('ping', {}, PING_TIMEOUT_MS);
      if (!response.ok) {
        this.healthy = false;
        return false;
      }

      const ping = parsePingResult(response.payload);
      if (!ping) {
        this.healthy = false;
        return false;
      }

      if (
        this.options.expectedHostVersion &&
        ping.hostVersion !== this.options.expectedHostVersion
      ) {
        this.options.log?.(
          `Roslyn host version mismatch: expected ${this.options.expectedHostVersion}, got ${ping.hostVersion}`,
        );
        this.healthy = false;
        return false;
      }

      this.healthy = true;
      return true;
    } catch (error) {
      this.options.log?.(`Roslyn ping failed: ${error instanceof Error ? error.message : String(error)}`);
      this.healthy = false;
      return false;
    }
  }

  async scan(request: RoslynScanRequest, signal?: AbortSignal): Promise<RoslynScanResult> {
    if (signal?.aborted) {
      throw new Error('Scan aborted');
    }

    await this.ensureProcess();
    if (!this.healthy) {
      const pingOk = await this.ping();
      if (!pingOk) {
        throw new Error('Roslyn host is unhealthy');
      }
    }

    const payload: Record<string, unknown> = {};
    if (request.solutionPath) {
      payload.solutionPath = request.solutionPath;
    }
    if (request.projectPath) {
      payload.projectPath = request.projectPath;
    }
    if (request.changedFiles?.length) {
      payload.changedFiles = request.changedFiles;
    }
    if (request.includeServiceDescriptorReplace !== undefined) {
      payload.includeServiceDescriptorReplace = request.includeServiceDescriptorReplace;
    }
    if (request.excludeTestProjects !== undefined) {
      payload.excludeTestProjects = request.excludeTestProjects;
    }
    if (request.enableKeyed !== undefined) {
      payload.enableKeyed = request.enableKeyed;
    }

    const response = await this.sendCommand('scan', payload, SCAN_TIMEOUT_MS, signal);
    if (!response.ok) {
      throw new Error(response.error?.message ?? 'Roslyn scan failed');
    }

    const scanResult = parseScanResult(response.payload);
    if (!scanResult) {
      throw new Error('Roslyn scan returned an invalid payload');
    }

    if (hasFatalScanErrors(scanResult.errors)) {
      throw new Error(scanResult.errors.find((e) => e.fatal)?.message ?? 'Roslyn scan failed fatally');
    }

    const scopeRoot = request.projectPath ?? request.solutionPath ?? '';
    const mapped = mapScanResultDto(scanResult, scopeRoot);

    return {
      registrations: mapped.registrations,
      edges: mapped.edges,
      errors: mapRoslynErrors(scanResult.errors),
    };
  }

  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      await this.sendCommand('shutdown', {}, SHUTDOWN_TIMEOUT_MS);
    } catch {
      // Host may exit before responding.
    } finally {
      this.killProcess();
    }
  }

  dispose(): void {
    void this.shutdown();
  }

  private async ensureProcess(): Promise<void> {
    if (this.process && !this.process.killed) {
      return;
    }

    this.process = spawn(this.options.hostPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.options.log?.(`[RoslynHost] ${text}`);
      }
    });

    this.process.on('exit', (code) => {
      this.options.log?.(`Roslyn host exited with code ${code ?? 'unknown'}`);
      this.rejectAllPending(new Error('Roslyn host process exited'));
      this.process = undefined;
      this.healthy = false;
    });

    const readline = createInterface({ input: this.process.stdout });
    readline.on('line', (line) => {
      const response = parseResponseLine(line);
      if (!response) {
        return;
      }

      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      pending.resolve(response);
    });
  }

  private sendCommand(
    cmd: 'ping' | 'scan' | 'shutdown',
    payload: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RoslynResponse> {
    const run = async (): Promise<RoslynResponse> => {
      if (!this.process?.stdin.writable) {
        throw new Error('Roslyn host stdin is not writable');
      }

      const id = randomUUID();
      const request = createRequest(id, cmd, payload);

      const responsePromise = new Promise<RoslynResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Roslyn ${cmd} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        this.pending.set(id, { resolve, reject, timer });

        if (signal) {
          const onAbort = (): void => {
            clearTimeout(timer);
            this.pending.delete(id);
            this.killProcess();
            reject(new Error('Scan aborted'));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });

      this.process.stdin.write(serializeRequest(request));
      return responsePromise;
    };

    this.requestQueue = this.requestQueue.then(run, run);
    return this.requestQueue;
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private killProcess(): void {
    if (!this.process) {
      return;
    }

    this.process.kill();
    this.process = undefined;
    this.healthy = false;
    this.rejectAllPending(new Error('Roslyn host process killed'));
  }
}