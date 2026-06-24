# DI Container Mapper — VS Code Extension

## Overview

A VS Code extension that scans .NET dependency-injection registrations (`AddSingleton`, `AddScoped`, `AddTransient`, etc.) and visualizes them as a dependency graph — surfacing lifetime mismatches, unregistered dependencies, and duplicate registrations before they become runtime exceptions.

---

## 1. Problem statement

In larger ASP.NET / Blazor solutions, DI registrations are spread across `Program.cs` and multiple extension methods (`AddApplicationServices()`, `AddInfrastructure()`, etc.). This keeps startup code clean, but makes it hard to answer simple questions without running the app:

- Is `IFooService` actually registered anywhere?
- What does a given service depend on, and are all of those dependencies registered too?
- Did I inject a **Scoped** service into a **Singleton**? (Captured-dependency bug — often works in dev, breaks under load in production.)
- Is the same interface registered twice, with the second silently overriding the first?

---

## 2. Goals

- Parse all DI registration calls across the solution into a single registry: type → lifetime → registration location.
- Build a dependency graph per service by inspecting constructor parameters.
- Detect and flag three classes of bugs: **lifetime mismatches**, **unregistered dependencies**, **duplicate registrations**.
- Visualize the graph (tree view + interactive webview) and surface issues via the standard VS Code Problems panel.
- Support cross-project scanning (registrations and consumers often live in different class library projects).

## 3. Non-goals (v1)

- Full IL/runtime analysis of the built container — this is purely static/source-based.
- Support for non-Microsoft DI containers (Autofac, etc.) — v2+ candidate if there's demand.
- Auto-fixing mismatches — this is a discovery/diagnostic tool, not a refactoring tool.

---

## 4. Detection scope — registration patterns

### Standard registration calls

```regex
# AddSingleton<TInterface, TImpl>() / AddScoped<...>() / AddTransient<...>()
Add(Singleton|Scoped|Transient)<([\w.]+)(?:,\s*([\w.]+))?>\s*\(\s*\)

# Concrete-type-only registration (no interface)
Add(Singleton|Scoped|Transient)<([\w.]+)>\s*\(\s*\)

# TryAdd variants
TryAdd(Singleton|Scoped|Transient)<([\w.]+)(?:,\s*([\w.]+))?>
```

### Factory-based registration

```regex
Add(Singleton|Scoped|Transient)<([\w.]+)>\s*\(\s*\w+\s*=>\s*new\s+([\w.]+)
```
Factory bodies often call `sp.GetService<T>()` / `sp.GetRequiredService<T>()` internally — these calls should also be parsed to extract additional implicit dependencies the constructor-parameter scan wouldn't catch.

### Keyed services (.NET 8+)

```regex
AddKeyed(Singleton|Scoped|Transient)<([\w.]+)(?:,\s*([\w.]+))?>\s*\(\s*["']?([\w-]+)["']?
```
Keyed registrations should be tracked separately from non-keyed ones — they're not interchangeable even if the interface matches.

### Notes

- Regex gets registration *calls* reliably, but resolving generic type arguments to fully-qualified types, and extracting constructor parameter types, requires semantic analysis — see §7.
- Extension methods like `services.AddApplicationServices()` need to be followed into their own method bodies (possibly in another file/project) to find the actual `AddXxx<>()` calls inside.

---

## 5. Dependency graph construction

For each registered concrete type, inspect its primary constructor's parameters:

1. For each parameter type, look up whether it exists in the registration registry.
2. If found → draw an edge `Type → Dependency` annotated with both lifetimes.
3. If not found → flag as **unregistered dependency**.
4. Recurse to build the full transitive graph (useful for the "what does this actually pull in" view).

---

## 6. Issue detection rules

| Issue | Condition | Severity |
|---|---|---|
| **Captured dependency** | Singleton constructor-depends-on Scoped | 🔴 Error — will throw `InvalidOperationException` at runtime (when scope validation is on) or silently misbehave |
| **Trapped transient** | Singleton constructor-depends-on Transient | 🟡 Warning — transient gets pinned to singleton lifetime, defeating its purpose |
| **Unregistered dependency** | Constructor parameter type has no matching registration | 🔴 Error — will throw at resolution time |
| **Duplicate registration** | Same interface registered more than once | 🟡 Warning — last registration silently wins; likely unintentional |
| Scoped → Transient, Transient → anything | — | 🟢 No issue |

Mismatches surface in both the custom tree view and the native VS Code **Problems panel** (so they show up alongside compiler warnings, not just in a separate UI).

---

## 7. Implementation reality check — regex vs. Roslyn

Regex matching is sufficient for *finding registration call sites*, but is not reliable for:
- Resolving generic type arguments to fully-qualified type names (namespace resolution, `using` aliases)
- Extracting and resolving constructor parameter types, especially with generic constraints or multiple constructors
- Following extension methods into other files/projects

**Recommended staged approach:**
- **v1**: Regex-based scanning, handles direct `AddXxx<TInterface, TImpl>()` calls in the same file/project. Good enough for straightforward solutions and to validate the UI/UX.
- **v2**: Layer in Roslyn (`Microsoft.CodeAnalysis.CSharp`) for real semantic resolution — load the workspace via `MSBuildWorkspace`, walk the syntax trees for invocation expressions matching `Add*` patterns, and use the semantic model to resolve actual `ITypeSymbol`s for both the registered type and constructor parameters. This is what makes cross-project and generic-constraint cases work correctly.

---

## 8. Architecture

```
Extension Host
 ├── Registration Scanner   — finds AddXxx<>() calls (regex v1 → Roslyn v2)
 ├── Extension Method Resolver — follows services.AddXxx() into its definition
 ├── Constructor Inspector   — extracts dependency types per registered service
 ├── Graph Builder            — builds the type → lifetime → dependencies graph
 ├── Issue Detector           — applies rules from §6
 ├── Tree View Provider        — sidebar grouped by lifetime
 ├── Webview Graph Panel        — interactive node graph
 ├── Diagnostics Provider        — pushes issues into the Problems panel
 └── CodeLens Provider            — inline annotations on Program.cs / extension methods
```

**Indexing strategy:** full scan on workspace load; incremental re-scan of changed files on save, similar to the LinkLoops indexing approach.

---

## 9. UI / UX

### Sidebar Tree View
Grouped by lifetime — **Singleton**, **Scoped**, **Transient** — each entry showing a status icon:
- ✅ green check — registered, no issues
- 🔴 red — has a flagged issue (mismatch, unregistered dep, duplicate)
- Clicking an entry expands its direct dependencies

### Interactive graph (webview panel)
- Node-link graph, nodes color-coded by lifetime
- Edges colored red where a lifetime mismatch occurs, with a short label (e.g. "captured!")
- Click any node to jump to its registration line in source

### CodeLens
Inline above each `AddXxx<>()` call: `N dependencies` / `⚠ captures a scoped service` / `⚠ unregistered dependency: IBar`

### Problems panel integration
Each detected issue (captured dependency, unregistered dependency, duplicate registration) appears as a standard VS Code diagnostic, clickable to jump to the registration line — consistent with how compiler errors/warnings already behave.

### Commands
- **"Map DI Container"** — full workspace scan + report
- **"Show Dependency Graph"** — opens the webview panel for a selected service
- **Right-click on a class → "Show DI Dependencies"**

---

## 10. Roadmap

- **v1** — Regex-based registration scanning (single project), constructor inspection via regex/heuristics, lifetime mismatch + duplicate detection, tree view, CodeLens.
- **v1.5** — Problems panel integration, interactive graph webview.
- **v2** — Roslyn-based semantic analysis for accurate cross-project resolution, generic constraints, factory-body dependency extraction (parsing `sp.GetService<T>()` calls inside lambdas).
- **v2.5** — Support for keyed services (.NET 8+) as a first-class graph dimension; optional support for Autofac/other containers if there's user demand.

---

## 11. Tech stack notes

- TypeScript, VS Code Extension API: `vscode.languages.createDiagnosticCollection`, `vscode.window.createWebviewPanel`, `vscode.languages.registerCodeLensProvider`.
- v2 Roslyn integration likely needs an out-of-process C# analysis host (a small .NET console tool invoked from the extension, communicating via stdio/JSON) since Roslyn itself isn't accessible directly from a TypeScript/Node extension host.
- Graph rendering: a lightweight library like `vis-network` or `d3` inside the webview for the interactive node-link view.
- Reuse the file-scanning and incremental-indexing patterns from LinkLoops where possible — the "scan workspace once, re-scan changed files on save" architecture is identical.
