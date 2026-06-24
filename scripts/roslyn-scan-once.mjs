import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDll = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'RoslynHost',
  'bin',
  'Release',
  'net8.0',
  'RoslynHost.dll',
);

const target = process.argv[2];
const mode = process.argv[3] ?? 'project';
if (!target) {
  console.error('Usage: node scripts/roslyn-scan-once.mjs <csproj-or-sln> [project|solution]');
  process.exit(1);
}

const payload =
  mode === 'solution'
    ? { solutionPath: target, projectPath: target.replace(/[^/\\]+$/, '').replace(/[\\/]$/, '') }
    : { projectPath: target };

const proc = spawn('dotnet', [hostDll], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const rl = createInterface({ input: proc.stdout });

proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

function send(cmd, body = {}) {
  const id = randomUUID();
  const line = JSON.stringify({ protocolVersion: 1, id, cmd, payload: body });
  proc.stdin.write(`${line}\n`);
  return new Promise((resolve, reject) => {
    const onLine = (responseLine) => {
      const response = JSON.parse(responseLine);
      if (response.id !== id) return;
      rl.off('line', onLine);
      if (!response.ok) reject(new Error(response.error?.message ?? 'request failed'));
      else resolve(response.payload);
    };
    rl.on('line', onLine);
  });
}

try {
  const ping = await send('ping');
  console.log('ping:', ping);

  const result = await send('scan', payload);
  console.log(`registrations=${result.registrations.length}`);
  console.log(`constructorDeps=${result.constructorDeps.length}`);
  console.log(`factoryDeps=${result.factoryDeps.length}`);
  console.log(`errors=${result.errors.length}`);

  if (result.errors.length) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  [${error.fatal ? 'FATAL' : 'warn'}] ${error.code}: ${error.message}`);
    }
  }

  const byService = new Map();
  for (const reg of result.registrations) {
    const list = byService.get(reg.serviceTypeFqName) ?? [];
    list.push(reg);
    byService.set(reg.serviceTypeFqName, list);
  }

  const duplicates = [...byService.entries()].filter(([, list]) => list.length > 1);
  console.log(`\nDuplicate service types: ${duplicates.length}`);
  for (const [service, list] of duplicates.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${service} (${list.length}x)`);
    for (const item of list) {
      const rel = item.filePath.split(/[/\\]/).slice(-2).join('/');
      console.log(`    - ${rel}:${item.startLine + 1} ${item.lifetime} ${item.isFactory ? 'factory' : ''}`);
    }
  }

  const programRegs = result.registrations.filter((r) => r.filePath.toLowerCase().endsWith('program.cs'));
  console.log(`\nProgram.cs registrations: ${programRegs.length}`);
  for (const reg of programRegs.sort((a, b) => a.startLine - b.startLine)) {
    console.log(
      `  L${reg.startLine + 1}: ${reg.lifetime} ${reg.serviceTypeFqName} -> ${reg.implementationTypeFqName}${reg.isFactory ? ' (factory)' : ''}`,
    );
  }

  await send('shutdown');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  proc.kill();
}