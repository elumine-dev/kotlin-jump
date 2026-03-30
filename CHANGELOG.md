# Changelog

## 0.2.2

Patch release that improves publish-script reliability by regenerating the lockfile with a CI-compatible npm version before tagging.

### Packaging and docs
- Added `sync_lockfile` step to the publish script so `package-lock.json` is regenerated with a CI-compatible npm version on every release
- Introduced `CLAUDE_PUBLISH_LOCKFILE_NPM` environment variable to override the npm command used during lockfile refresh (default: `npx -y npm@10`)
- Bumped version to 0.2.2

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
