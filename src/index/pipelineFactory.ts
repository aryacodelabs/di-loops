import { RegexConstructorInspector } from '../constructor/constructorInspector';
import { buildGraph } from '../graph/graphBuilder';
import { detectIssues } from '../issues/issueDetector';
import type { ScanPipelineDeps } from '../interfaces';
import { RegexExtensionMethodResolver } from '../resolver/extensionMethodResolver';
import { RegexInjectionSiteScanner } from '../scanner/injectionSiteScanner';
import { RegexRegistrationScanner } from '../scanner/regexRegistrationScanner';
import type { IScannerFileAccess } from '../scanner/scannerFileAccess';

export function createScanPipelineDeps(fileAccess: IScannerFileAccess): ScanPipelineDeps {
  return {
    scanner: new RegexRegistrationScanner(fileAccess),
    extensionMethodResolver: new RegexExtensionMethodResolver(fileAccess),
    constructorInspector: new RegexConstructorInspector(fileAccess),
    injectionSiteScanner: new RegexInjectionSiteScanner(fileAccess),
    buildGraph,
    detectIssues,
  };
}