import { describe, expect, it } from 'vitest';
import { detectIssues } from '../../src/issues/issueDetector';
import type { DependencyEdge, DiGraph, Registration } from '../../src/types';

function registration(
  id: string,
  serviceType: string,
  implementationType: string,
  lifetime: Registration['lifetime'],
): Registration {
  return {
    id,
    serviceType,
    implementationType,
    lifetime,
    isTryAdd: false,
    isFactory: false,
    location: {
      fileUri: 'file:///Program.cs',
      range: { startLine: 1, startCol: 0, endLine: 1, endCol: 20 },
    },
  };
}

function graph(
  registrations: Registration[],
  edges: DependencyEdge[],
  implFileTexts: Record<string, string> = {},
): DiGraph {
  return {
    registrations,
    edges,
    issues: [],
    indexedAt: Date.now(),
    scannerVersion: 'regex-v1',
    detectionContext: { implFileTexts, implFileUris: {}, scopeRoot: 'C:/app' },
  };
}

describe('detectIssues', () => {
  it('detects captured scoped dependency in singleton', () => {
    const host = registration('host', 'IAppHost', 'AppHost', 'Singleton');
    const scoped = registration('ctx', 'IUserContext', 'UserContext', 'Scoped');
    const issues = detectIssues(
      graph(
        [host, scoped],
        [{ fromRegistrationId: 'host', toType: 'IUserContext', resolution: 'constructor' }],
      ),
    );

    expect(issues.some((i) => i.kind === 'CAPTURED_SCOPED')).toBe(true);
  });

  it('detects trapped transient in singleton', () => {
    const worker = registration('worker', 'Worker', 'Worker', 'Singleton');
    const transient = registration('ts', 'ITransientService', 'TransientService', 'Transient');
    const issues = detectIssues(
      graph(
        [worker, transient],
        [{ fromRegistrationId: 'worker', toType: 'ITransientService', resolution: 'constructor' }],
      ),
    );

    expect(issues.some((i) => i.kind === 'TRAPPED_TRANSIENT')).toBe(true);
  });

  it('allows duplicate service types when keyed keys differ', () => {
    const first = {
      ...registration('cache1', 'ICache', 'RedisCache', 'Singleton'),
      key: 'primary',
    };
    const second = {
      ...registration('cache2', 'ICache', 'MemoryCache', 'Singleton'),
      key: 'secondary',
    };
    const issues = detectIssues(graph([first, second], []));

    expect(issues.filter((i) => i.kind === 'DUPLICATE')).toHaveLength(0);
  });

  it('detects duplicate keyed registrations for the same key', () => {
    const first = {
      ...registration('cache1', 'ICache', 'RedisCache', 'Singleton'),
      key: 'primary',
    };
    const second = {
      ...registration('cache2', 'ICache', 'MemoryCache', 'Singleton'),
      key: 'primary',
    };
    const issues = detectIssues(graph([first, second], []));

    expect(issues.filter((i) => i.kind === 'DUPLICATE')).toHaveLength(2);
    expect(issues[0]?.relatedType).toBe('ICache@primary');
  });

  it('does not treat keyed and non-keyed registrations as duplicates', () => {
    const keyed = {
      ...registration('cache1', 'ICache', 'RedisCache', 'Singleton'),
      key: 'primary',
    };
    const plain = registration('cache2', 'ICache', 'MemoryCache', 'Singleton');
    const issues = detectIssues(graph([keyed, plain], []));

    expect(issues.filter((i) => i.kind === 'DUPLICATE')).toHaveLength(0);
  });

  it('detects duplicate non-TryAdd registrations', () => {
    const first = registration('email1', 'IEmailSender', 'SmtpEmailSender', 'Singleton');
    const second = registration('email2', 'IEmailSender', 'GraphEmailSender', 'Singleton');
    const issues = detectIssues(graph([first, second], []));

    expect(issues.filter((i) => i.kind === 'DUPLICATE')).toHaveLength(2);
  });

  it('detects unregistered injection sites in controllers', () => {
    const issues = detectIssues({
      registrations: [],
      edges: [],
      issues: [],
      indexedAt: Date.now(),
      scannerVersion: 'regex-v1',
      detectionContext: {
        implFileTexts: {},
        implFileUris: {},
        hostFileTexts: {
          'file:///Controllers/HomeController.cs': `using App.Services;
public class HomeController {
  public HomeController(IErrorLogging errorLogging) {}
}`,
        },
        scopeRoot: 'C:/app',
        injectionSites: [
          {
            hostTypeName: 'HomeController',
            parameterType: 'IErrorLogging',
            fileUri: 'file:///Controllers/HomeController.cs',
            range: { startLine: 2, startCol: 24, endLine: 2, endCol: 37 },
          },
        ],
      },
    });

    expect(
      issues.some(
        (issue) => issue.code === 'UNREGISTERED_INJECTION' && issue.relatedType === 'IErrorLogging',
      ),
    ).toBe(true);
  });

  it('detects unregistered constructor dependencies', () => {
    const order = registration('order', 'IOrderService', 'OrderService', 'Singleton');
    const repo = registration('repo', 'IOrderRepository', 'OrderRepository', 'Singleton');
    const issues = detectIssues(
      graph(
        [order, repo],
        [{ fromRegistrationId: 'order', toType: 'IPaymentGateway', resolution: 'constructor' }],
      ),
    );

    expect(issues.some((i) => i.kind === 'UNREGISTERED' && i.relatedType === 'IPaymentGateway')).toBe(
      true,
    );
  });
});