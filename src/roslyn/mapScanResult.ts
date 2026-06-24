import { computeRegistrationLogicalKey } from '../registration/registrationId';
import type { DependencyEdge, Registration } from '../types';
import { getSimpleTypeName } from '../util/typeNames';
import type { ConstructorDepDto, FactoryDepDto, RegistrationDto, ScanResultDto } from './protocol';

export interface MappedRoslynScan {
  registrations: Registration[];
  edges: DependencyEdge[];
}

export function mapScanResultDto(
  result: ScanResultDto,
  scopeRoot: string,
): MappedRoslynScan {
  const registrations = result.registrations.map((dto) => mapRegistrationDto(dto, scopeRoot));
  const registrationByImpl = new Map<string, Registration[]>();

  for (const registration of registrations) {
    const implKey = registration.implementationType.toLowerCase();
    const list = registrationByImpl.get(implKey) ?? [];
    list.push(registration);
    registrationByImpl.set(implKey, list);

    const simpleKey = getSimpleTypeName(registration.implementationType).toLowerCase();
    const simpleList = registrationByImpl.get(simpleKey) ?? [];
    simpleList.push(registration);
    registrationByImpl.set(simpleKey, simpleList);
  }

  const edges: DependencyEdge[] = [
    ...mapConstructorDeps(result.constructorDeps, registrations, registrationByImpl),
    ...mapFactoryDeps(result.factoryDeps, registrations, registrationByImpl),
  ];

  return { registrations, edges };
}

function mapRegistrationDto(dto: RegistrationDto, scopeRoot: string): Registration {
  const fileUri = toFileUri(dto.filePath);
  const implementationType = dto.implementationTypeFqName;
  const serviceType = dto.serviceTypeFqName;

  return {
    id: computeRegistrationLogicalKey({
      scopeRoot,
      fileUri,
      serviceType,
      implementationType,
      lifetime: dto.lifetime,
      key: dto.key ?? undefined,
    }),
    serviceType,
    implementationType,
    lifetime: dto.lifetime,
    isTryAdd: dto.isTryAdd,
    isFactory: dto.isFactory,
    key: dto.key ?? undefined,
    location: {
      fileUri,
      range: {
        startLine: dto.startLine,
        startCol: dto.startColumn,
        endLine: dto.endLine ?? dto.startLine,
        endCol: dto.endColumn ?? dto.startColumn + 1,
      },
    },
    projectPath: scopeRoot,
  };
}

function mapConstructorDeps(
  deps: ConstructorDepDto[],
  registrations: Registration[],
  registrationByImpl: Map<string, Registration[]>,
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  for (const dep of deps) {
    const fromRegistration = findRegistrationForImpl(dep.implFqName, registrationByImpl);
    if (!fromRegistration) {
      continue;
    }

    edges.push({
      fromRegistrationId: fromRegistration.id,
      toType: dep.paramFqName,
      resolution: 'constructor',
      toRegistrationId: findTargetRegistration(dep.paramFqName, registrations)?.id,
    });
  }

  return edges;
}

function mapFactoryDeps(
  deps: FactoryDepDto[],
  registrations: Registration[],
  registrationByImpl: Map<string, Registration[]>,
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  for (const dep of deps) {
    const fromRegistration = findRegistrationForImpl(dep.registrationFqName, registrationByImpl);
    if (!fromRegistration) {
      continue;
    }

    edges.push({
      fromRegistrationId: fromRegistration.id,
      toType: dep.resolvedFqName,
      resolution: 'factory',
      toRegistrationId: findTargetRegistration(dep.resolvedFqName, registrations)?.id,
    });
  }

  return edges;
}

function findRegistrationForImpl(
  implFqName: string,
  registrationByImpl: Map<string, Registration[]>,
): Registration | undefined {
  const exact = registrationByImpl.get(implFqName.toLowerCase());
  if (exact && exact.length > 0) {
    return exact[0];
  }

  const simple = getSimpleTypeName(implFqName).toLowerCase();
  const bySimple = registrationByImpl.get(simple);
  return bySimple?.[0];
}

function findTargetRegistration(
  typeName: string,
  registrations: Registration[],
): Registration | undefined {
  const simple = getSimpleTypeName(typeName);
  return registrations.find(
    (registration) =>
      registration.serviceType === typeName ||
      registration.implementationType === typeName ||
      getSimpleTypeName(registration.serviceType) === simple ||
      getSimpleTypeName(registration.implementationType) === simple,
  );
}

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}