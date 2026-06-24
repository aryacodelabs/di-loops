import { describe, expect, it } from 'vitest';
import { mapScanResultDto } from '../../src/roslyn/mapScanResult';
import type { ScanResultDto } from '../../src/roslyn/protocol';

describe('mapScanResultDto', () => {
  it('maps registrations and dependency edges from Roslyn DTOs', () => {
    const dto: ScanResultDto = {
      registrations: [
        {
          serviceTypeFqName: 'IOrderService',
          implementationTypeFqName: 'OrderService',
          lifetime: 'Scoped',
          filePath: 'C:/repo/Program.cs',
          startLine: 10,
          startColumn: 8,
          isTryAdd: false,
          isFactory: false,
        },
        {
          serviceTypeFqName: 'IEmailSender',
          implementationTypeFqName: 'SmtpEmailSender',
          lifetime: 'Transient',
          filePath: 'C:/repo/Program.cs',
          startLine: 11,
          startColumn: 8,
          isTryAdd: false,
          isFactory: false,
        },
      ],
      constructorDeps: [
        {
          implFqName: 'OrderService',
          paramFqName: 'IEmailSender',
          filePath: 'C:/repo/Services/OrderService.cs',
          line: 3,
        },
      ],
      factoryDeps: [],
      errors: [],
    };

    const mapped = mapScanResultDto(dto, 'C:/repo');
    expect(mapped.registrations).toHaveLength(2);
    expect(mapped.edges).toHaveLength(1);
    expect(mapped.edges[0]).toMatchObject({
      toType: 'IEmailSender',
      resolution: 'constructor',
    });
  });
});