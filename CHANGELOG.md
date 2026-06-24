# Changelog

All notable changes to **DI-Loops** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

---

## [0.2.1] - 2026-06-24

### Added

- **Unregistered** top-level group in the DI Registrations tree for constructor injection sites (e.g. ASP.NET controllers)
- Injection-site diagnostics on unregistered ctor parameters (`UNREGISTERED_INJECTION`) in the Problems panel
- `revealIssue` command — navigate from an unregistered injection entry to the parameter in source

### Changed

- Extension icon updated (`media/icon.png`)

### Fixed

- Injection-site scanning now runs on the Roslyn pipeline path (not only regex)
- Using-aware type lookup for injection sites via host file text
- Duplicate registration issues no longer incorrectly deduplicated across different registration lines

---

## [0.2.0] - 2026-06-24

### Added

- Roslyn analysis host (`tools/RoslynHost`) with NDJSON `ping` / `scan` / `shutdown` protocol
- TypeScript Roslyn client with automatic regex fallback on host failure
- Settings: `includeServiceDescriptorReplace`, `excludeTestProjects`, `enableKeyed`
- Keyed service parsing (`AddKeyed*` / `TryAddKeyed*`) for regex and Roslyn scanners
- Registry dimension `serviceType@key` — keyed and non-keyed registrations are not interchangeable
- **Keyed** top-level group in the DI Registrations tree
- Graph nodes annotated with `@key`; keyed services excluded from unkeyed dependency resolution
- Per-key duplicate detection in issue badges and Problems panel

### Changed

- README and marketplace documentation expanded (features, installation, usage)
- Extension icon updated for VS Marketplace
- `package.json` author set to **AryaCode Labs**, publisher **AryaCodeLabs**

---

## [0.1.0] - 2026-06-01

### Added

- Regex-based DI registration scanner with extension-method resolution
- Constructor-derived dependency graph and lifetime issue detection
- DI Registrations tree view, CodeLens, Problems panel, and status bar
- Interactive dependency graph webview (vis-network)
- Incremental re-scan on save
- Comment-aware scanning (`//` and `/* */`)
- Startup project scope detection under `.sln` files
- Broader patterns: instance args, lambda factories, `ServiceDescriptor.Replace`
- Extension branding as **DI-Loops**

[Unreleased]: https://github.com/aryacodelabs/di-loops/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/aryacodelabs/di-loops/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aryacodelabs/di-loops/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aryacodelabs/di-loops/releases/tag/v0.1.0