# Changelog

## 0.7.1

Fixes outgoing Call Hierarchy for expression-body functions with default parameter values.

### Fixes
- Fixed outgoing Call Hierarchy for expression-body functions that include default parameter values (e.g., `fun f(x: Int = 0) = call()`). The `=` in a default value was previously mistaken for the expression-body marker, causing all outgoing calls from those functions to be silently dropped from the Call Hierarchy panel.

## 0.7.0

Adds a standalone LSP server for Neovim, Helix, and Zed; a smarter rename provider with import and file rename support; KMP source set awareness; and companion mode for coexisting with JetBrains Kotlin LSP.

### Improvements
- Added a standalone LSP server so Neovim, Helix, Zed, and other LSP-compatible editors can use Kotlin Jump's navigation — Go to Definition, Find Usages, and Go to Implementation — without VS Code.
- Added companion mode: when the JetBrains Kotlin LSP is detected in the workspace, Kotlin Jump automatically disables its overlapping providers so the two extensions coexist without producing duplicate results.
- Upgraded the rename provider to update import statements across files and rename the file itself when renaming a top-level declaration, making symbol renames more complete and less error-prone.
- Added Kotlin Multiplatform source set detection so module display names in Find Usages results correctly reflect KMP source sets (e.g., commonMain, androidMain) rather than showing generic module paths.

### Fixes
- Capped Find Usages results at 500 per inner search loop, preventing runaway queries from stalling the editor in very large workspaces.

## 0.6.0

Adds a tree-sitter WASM parser for more accurate Kotlin navigation, Go to Composable Preview for Jetpack Compose, and expanded settings for tuning indexing behavior — plus a fix for member symbol disambiguation in Go to Definition and Find Usages.

### Improvements
- Integrated a tree-sitter WASM Kotlin parser that resolves symbols more accurately across complex Kotlin patterns, reducing incorrect or missing results in Go to Definition and Find Usages.
- Added Go to Composable Preview navigation so Jetpack Compose developers can jump directly to @Preview-annotated functions from the command palette.
- Expanded configurable settings to give more control over indexing behavior: file size limits, snapshot caching, reference exclusions, test source set paths, watcher debounce timing, and status bar visibility.

### Fixes
- Fixed member symbol disambiguation so Go to Definition and Find Usages correctly identify the intended symbol when multiple classes define identically-named members or functions.

## 0.5.0

Adds semantic token highlighting and a TextMate syntax grammar for Kotlin, letting compatible themes color Kotlin-specific constructs like Composable functions, extension functions, and sealed classes.

### Improvements
- Added semantic token highlighting so compatible VS Code themes can apply distinct colors to Kotlin-specific constructs — including Composable functions, extension functions, sealed classes, and inline, infix, operator, and override members — giving Kotlin code more accurate, expressive coloring than generic token types allow.
- Added a TextMate grammar for Kotlin, providing consistent baseline syntax highlighting across all themes even without semantic token support.
- Added Kotlin language configuration, enabling standard editor behaviors such as bracket matching, comment toggling, and auto-closing pairs in Kotlin files.

## 0.4.0

Adds native Call Hierarchy and Type Hierarchy navigation, and fixes Find Usages false positives from comments, strings, and generated files.

### Improvements
- Added Call Hierarchy support — navigate incoming calls (who calls a function) and outgoing calls (what a function calls) using VS Code's native Call Hierarchy panel, with no language server required.
- Added Type Hierarchy support — explore class supertypes and subtypes with enriched detail in VS Code's native Type Hierarchy panel; also fixes parsing of single-letter supertype names so short class names resolve correctly.

### Fixes
- Find Usages no longer returns false matches from comments, string literals, or kapt-generated metadata files, reducing noise and improving result accuracy across large codebases.

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
