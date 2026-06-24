import { describe, expect, it } from 'vitest';
import {
  createRequest,
  hasFatalScanErrors,
  parsePingResult,
  parseResponseLine,
  parseScanResult,
  ROSLYN_PROTOCOL_VERSION,
  serializeRequest,
} from '../../src/roslyn/protocol';

describe('roslyn protocol', () => {
  it('serializes and parses requests', () => {
    const request = createRequest('abc', 'ping');
    expect(serializeRequest(request)).toBe(
      `{"protocolVersion":${ROSLYN_PROTOCOL_VERSION},"id":"abc","cmd":"ping","payload":{}}\n`,
    );
  });

  it('parses ping and scan responses', () => {
    const ping = parseResponseLine(
      JSON.stringify({
        protocolVersion: 1,
        id: 'abc',
        ok: true,
        payload: { hostVersion: '0.2.0', roslynVersion: '4.11.0', rid: 'win-x64' },
      }),
    );

    expect(ping?.ok).toBe(true);
    expect(parsePingResult(ping?.payload)).toEqual({
      hostVersion: '0.2.0',
      roslynVersion: '4.11.0',
      rid: 'win-x64',
    });

    const scan = parseScanResult({
      registrations: [
        {
          serviceTypeFqName: 'IApp',
          implementationTypeFqName: 'App',
          lifetime: 'Singleton',
          filePath: 'C:/repo/Program.cs',
          startLine: 1,
          startColumn: 4,
          isTryAdd: false,
          isFactory: false,
        },
      ],
      constructorDeps: [],
      factoryDeps: [],
      errors: [{ code: 'WARN', message: 'partial', fatal: false }],
    });

    expect(scan?.registrations).toHaveLength(1);
    expect(hasFatalScanErrors(scan?.errors ?? [])).toBe(false);
    expect(hasFatalScanErrors([{ code: 'X', message: 'bad', fatal: true }])).toBe(true);
  });
});