# Changelog

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
