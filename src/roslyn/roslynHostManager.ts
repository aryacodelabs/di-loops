import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { IRoslynHostClient } from '../interfaces';
import { RoslynHostClient } from './roslynHostClient';

const HOST_EXE_NAME = process.platform === 'win32' ? 'RoslynHost.exe' : 'RoslynHost';

export interface RoslynHostChecksumEntry {
  url: string;
  sha256: string;
}

export interface RoslynHostChecksumManifest {
  hostVersion: string;
  rids: Record<string, RoslynHostChecksumEntry>;
}

export class RoslynHostManager implements vscode.Disposable {
  private client: RoslynHostClient | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log?: (message: string) => void,
  ) {}

  async getClient(): Promise<IRoslynHostClient | undefined> {
    const hostPath = await this.resolveHostPath();
    if (!hostPath) {
      return undefined;
    }

    if (!this.client) {
      const manifest = this.readChecksumManifest();
      this.client = new RoslynHostClient({
        hostPath,
        expectedHostVersion: manifest?.hostVersion,
        log: this.log,
      });
    }

    return this.client;
  }

  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
      this.client = undefined;
    }
  }

  private readChecksumManifest(): RoslynHostChecksumManifest | undefined {
    const manifestPath = path.join(this.context.extensionPath, 'roslynHostChecksums.json');
    if (!fs.existsSync(manifestPath)) {
      return undefined;
    }

    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RoslynHostChecksumManifest;
    } catch {
      return undefined;
    }
  }

  private async resolveHostPath(): Promise<string | undefined> {
    const configured = vscode.workspace
      .getConfiguration('diContainerMapper')
      .get<string>('roslynHostPath', '')
      .trim();

    if (configured) {
      const resolved = path.isAbsolute(configured)
        ? configured
        : path.join(this.context.extensionPath, configured);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
      this.log?.(`Configured roslynHostPath does not exist: ${resolved}`);
    }

    const devCandidates = [
      path.join(this.context.extensionPath, 'tools', 'RoslynHost', 'bin', 'Release', 'net8.0', HOST_EXE_NAME),
      path.join(this.context.extensionPath, 'tools', 'RoslynHost', 'bin', 'Debug', 'net8.0', HOST_EXE_NAME),
      path.join(
        this.context.extensionPath,
        'tools',
        'RoslynHost',
        'bin',
        'Release',
        'net8.0',
        'publish',
        HOST_EXE_NAME,
      ),
    ];

    for (const candidate of devCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const cached = await this.resolveCachedHostPath();
    if (cached) {
      return cached;
    }

    this.log?.('Roslyn host not found. Build tools/RoslynHost or set diContainerMapper.roslynHostPath.');
    return undefined;
  }

  private async resolveCachedHostPath(): Promise<string | undefined> {
    const manifest = this.readChecksumManifest();
    if (!manifest) {
      return undefined;
    }

    const rid = getRuntimeIdentifier();
    const entry = manifest.rids[rid];
    if (!entry) {
      return undefined;
    }

    const cacheDir = path.join(this.context.globalStorageUri.fsPath, 'roslyn-host', manifest.hostVersion);
    const hostPath = path.join(cacheDir, HOST_EXE_NAME);
    if (fs.existsSync(hostPath)) {
      const valid = await verifySha256(hostPath, entry.sha256);
      if (valid) {
        return hostPath;
      }
      this.log?.('Cached Roslyn host failed checksum verification');
    }

    return undefined;
  }
}

function getRuntimeIdentifier(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') {
    return `win-${arch}`;
  }
  if (process.platform === 'darwin') {
    return `osx-${arch}`;
  }
  return `linux-${arch}`;
}

async function verifySha256(filePath: string, expected: string): Promise<boolean> {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex').toLowerCase() === expected.toLowerCase();
}