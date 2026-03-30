# Changelog

## 0.3.0

Adds inline CodeLens counts showing usages and implementations directly above class and function declarations.

### Improvements
- Added inline CodeLens annotations that display usages and implementations counts above class and function declarations, making call-site density and interface coverage visible at a glance without running a search.
- Introduced a `kotlinJump.codeLens` setting (default: on) to disable inline counts for users who prefer a cleaner editor gutter.

## 0.2.5

Maintenance release updating build tooling with no changes to extension behavior.

### Notes
- No changes to extension commands, settings, or navigation behavior in this release.

### Packaging and Docs
- Updated esbuild from 0.20 to 0.27, keeping the extension built against current bundler improvements.
- Updated README install commands to reference the 0.2.5 VSIX.

## 0.2.4

Internal quality release adding Compose and ViewModel parser test coverage, a minor KotlinParser fix, and CI upgrades — no changes to extension behavior.

### Improvements
- Added unit tests for Jetpack Compose and ViewModel parsing patterns, improving confidence that these Kotlin code styles are parsed correctly.
- Upgraded CI pipeline to GitHub Actions v6 and improved release automation, making future updates more consistent to publish.

### Notes
- No changes to extension commands, settings, or navigation behavior in this release.

### Packaging and Docs
- Updated README install commands to reference the current 0.2.4 VSIX.

## 0.2.3

This patch release improves Kotlin Jump's release reliability so future updates publish more consistently.

### Improvements
- Improved GitHub release automation so packaged updates and release notes publish more reliably

### Notes
- No functional changes to extension behavior

## 0.2.2

This patch release improves release preparation reliability so automated publishes stay aligned with CI.

### Improvements
- Regenerated the release lockfile with a CI-compatible npm version before tagging so local release prep matches GitHub Actions more consistently

### Notes
- No functional changes to extension behavior

## 0.2.1

Patch release with import resolution fixes and expanded edge-case test coverage across navigation providers.

### Fixes
- Reworked import resolution logic in ImportResolver — largest change in this release
- Updated DefinitionProvider, FindUsagesEngine, and HoverProvider with bug fixes
- Extended edge-case test coverage with 71 new test lines

### Packaging and docs
- Bumped version to 0.2.1

## 0.2.0

Release polish for the Kotlin Jump rename and packaging flow.

### Packaging and docs
- Added the Find Usages panel icon asset to the packaged extension
- Updated README install commands to the current `0.2.0` VSIX name
- Trimmed non-runtime files from the published VSIX
- Refreshed launch and marketing docs to use the Kotlin Jump branding and current links

## 0.1.0

Initial release.

### Navigation
- **Go to Definition** (Cmd+Click / F12) — FQN import resolution, typealias follow-through, test path isolation
- **Go to Implementation** (Cmd+F12) — interface → implementing classes, interface method → overrides
- **Find Usages** (Alt+F7) — custom panel with test/preview toggle filters, direct navigation on single result
- **Find All References** (Shift+F12) — configurable exclusion patterns via `excludeFromReferences`
- **Go to Test** (Alt+Shift+T) — toggle between class and test file by naming convention
- **Smart declaration navigation** — Cmd+Click on declaration: interface → implementations, method → overrides, no override → usages

### Editor features
- **Hover** — full signature, KDoc, package, module, sealed class subtypes, enum entries
- **Document Outline** (Cmd+Shift+O) — symbol hierarchy with visibility markers
- **Workspace Symbol Search** (Cmd+T) — fuzzy matching with kind filters (`@class:`, `@fun:`, `@compose:`)
- **Copy FQN** — right-click context menu command

### Performance
- Regex-based parsing on 4 worker threads — no language server
- Persistent snapshot — restores index on restart, re-parses only changed files
- All lookups < 1ms from 4 O(1) maps (byName, byFqn, byFile, bySuper)

### Supported languages
- Kotlin (`.kt`, `.kts`)
- Java (`.java`) — classes, interfaces, enums, records
