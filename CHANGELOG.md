# Changelog

## 1.7.1

Version 1.7.1 reduces CPU overhead during active editing by debouncing decoration scans and caching per-document symbol lookups in semantic highlighting.

### Notes
- No new commands, settings, or navigation features in this release — all changes are performance and reliability improvements to existing visual annotations.
- Adversarial and performance test suites were added for the affected providers, increasing confidence that decoration and semantic highlighting remain correct under edge conditions.

### Performance
- Debounced keystroke-driven scans in NullAssertionProvider, HexColorFoldingProvider, and StringResourceFoldingProvider — rapid typing no longer triggers a full document scan on every character.
- Added a per-document word cache in SemanticTokensProvider so symbols that appear multiple times in the same file are resolved only once per render pass.

### Performance
- Debounced the keystroke-driven decoration scan in `NullAssertionProvider`, `HexColorFoldingProvider`, and `StringResourceFoldingProvider` — rapid typing no longer triggers a full O(n) document scan on every character.
- Added a per-document word cache in `SemanticTokensProvider` to eliminate redundant `resolveBest()` calls for symbols that appear multiple times in the same file.

## 1.6.1

1.6.1 adds a one-click Android Run button, visual Kotlin code annotations (hex swatches, !! highlighting, @RequiresApi hints), extended string resource intelligence, and extends availability to VS Codium via the Open VSX Registry.

### Improvements
- Added a Run button to the status bar that builds, installs, and launches the Android app on the connected device or emulator in one click — no terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task, supports multi-flavor and multi-app projects via `kotlinJump.androidProjects`, and offers to boot an AVD if no device is connected.
- Added hex color swatches alongside color literals in Kotlin and Java files so color values are visible without a separate color picker.
- Added highlighting for !! null-assertion operators to make unsafe dereferences immediately visible during code review.
- Added @RequiresApi inlay hints, R.plurals and R.array folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed extension activation failure on VS Code versions predating 1.87, where an unguarded vscode.chat API call prevented the extension from loading entirely.

### Packaging and Docs
- Published to the Open VSX Registry — Kotlin Jump is now available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

## 1.7.0

Kotlin Jump 1.7.0 adds a one-click Android Run button, visual code annotations for hex colors and null assertions, richer string resource intelligence, and fixes a crash that prevented loading on older VS Code versions.

### Improvements
- Added a Run button in the status bar that builds, installs, and launches an Android app on the connected device or emulator in one click — no terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task; supports multi-flavor and multi-app workspaces via `kotlinJump.androidProjects`; offers to start an AVD if no device is connected, so the first Run click always works.
- Added hex color swatches alongside color literals in Kotlin and Java files, making color values visible without a separate color picker.
- Added highlighting for `!!` null-assertion operators so unsafe dereferences stand out immediately during code review.
- Added `@RequiresApi` inlay hints, `R.plurals` and `R.array` folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed an activation failure on VS Code versions predating 1.87, where an unguarded `vscode.chat` API call prevented the extension from loading entirely.

### Packaging and Docs
- Kotlin Jump is now published to the Open VSX Registry — available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

1.7.0 ships the Android Run button — build, install, and launch any Android app from VS Code in one click, zero config required.

### New Features
- Added a **$(play) Run** button in the status bar that builds, installs, and launches an Android app on the connected device or emulator in one click.
- Auto-detects the app module and Gradle install task via `gradlew tasks --group install` — works for any project including multi-flavor builds.
- Reads the merged manifest after a successful build to get the real package name and LAUNCHER activity, then launches via `adb shell am start -n` — the same method Android Studio uses.
- Offers to start an AVD if no device is connected: lists available emulators via `emulator -list-avds` and polls until boot completes.
- Background task discovery runs silently at workspace open so the first Run click is always instant.
- Added a **$(chevron-down)** switch button for projects with multiple apps configured via `kotlinJump.androidProjects`.
- Falls back to `adb shell monkey` if the merged manifest is not yet on disk (first build on a fresh checkout).

## 1.6.0

1.6.0 ships instant XML↔Kotlin string resource navigation via a pre-built index and fixes KDoc hover at declaration sites.

### Improvements
- Replaced per-navigation file scanning with a pre-built RResourceIndex, making jumps from R.string.* references to their XML definitions — and back — instant regardless of how many resource files the project contains.
- Added two-way string resource navigation: jump from an R.string.* reference in Kotlin or Java to its XML definition, and from an XML string entry back to all Kotlin and Java usages.

### Fixes
- Suppressed KDoc hover at a symbol's own declaration site, where it was redundant and visually noisy.
- Fixed base method lookup depth in KDoc resolution — hover now correctly surfaces inherited documentation from the nearest supertype rather than stopping prematurely.

### Notes
- Added adversarial test suites covering navigation providers, the hover provider, and the resource index — these are internal but directly increase confidence that navigation results remain correct across malformed inputs and edge conditions.

## 1.5.1

Documentation-only release: the README was fully rewritten with complete feature coverage, updated copy, and eight animated GIFs — no changes to extension behavior.

### Notes
- No changes to extension behavior, commands, settings, parsing, or navigation logic. This release is documentation only.

### Packaging and Docs
- Rewrote the README with complete, accurate coverage of all major features: Go to Definition, Find Usages, Code Lens, Test Navigation, onboarding walkthrough, AI assistant, String Folding, and Inlay Hints.
- Added eight animated GIFs to the README — one per feature area — so users can see each capability in action before installing.
- Added dedicated sections for the Code Lens, walkthrough, and AI assistant features, which lacked dedicated documentation in previous versions.

## 1.5.0

1.5.0 ships an interactive 8-step onboarding walkthrough and fixes a cluster of Go to Implementation, Code Lens, and Find Usages accuracy issues.

### Improvements
- Added an 8-step interactive walkthrough that opens automatically on first install; each step includes an animated demo covering Go to Definition, Find Usages, Code Lens, Test Navigation, String Folding, Inlay Hints, and the AI assistant — reopen anytime with "Kotlin Jump: Open Walkthrough" from the command palette.

### Fixes
- Go to Implementation now resolves correctly from call sites and navigates directly to the target without opening the interface file as an intermediate step.
- Cmd+Click on an override method now navigates to the supertype declaration rather than stopping at the override.
- Abstract and open functions are now indexed; Code Lens implementation counts correctly reflect their actual number of implementations.
- Find Usages eliminates Kotlin keyword false positives and no longer leaks debug log lines into search results.
- The @kotlin-jump chat participant handles more natural-language phrasings, case variations, and fully-qualified name lookups correctly.

## 1.4.1

1.4.1 adds a "What's New" panel that appears automatically after each update, improves type hierarchy with sorted subtypes and override counts, fixes outgoing call detection in expression-body functions, and tightens symbol disambiguation across all navigation providers.

### Improvements
- Added a "What's New" panel: appears once per version update and shows the release summary with highlights and links; reopen anytime with "Kotlin Jump: See What's New" from the command palette.
- Type hierarchy subtypes are now sorted by kind — interfaces first, then sealed, concrete, data classes, objects, and enums — and each subtype item shows how many parent methods it overrides (e.g. "overrides 2/5"). Sealed class lists show an exhaustive count ("3/3 exhaustive").
- Implementation counts in CodeLens and type hierarchy now apply a same-name collision guard, preventing inflated counts when identically named classes exist in different packages.
- Import aliases (e.g. `import com.example.Foo as Bar`) are now recognized in symbol resolution — navigation and rename work correctly when the alias name is used in code.
- Rename now uses import context to identify the precise class declaration when multiple classes share the same simple name, preventing the wrong .kt file from being renamed.

### Fixes
- Call hierarchy outgoing calls now include functions called inside expression-body (`fun f() = expr`) and inline-block (`fun f() { call() }`) declarations, which were previously not scanned.

### Notes
- Ten new adversarial and fuzz test suites were added covering call hierarchy, code lens, import resolution, the Java and Kotlin parsers, rename, symbol index, type hierarchy, and organize imports — increasing confidence in correctness across edge conditions.

## 1.4.0

Clicking a usage-count CodeLens now opens the Find Usages panel immediately by reusing the already-computed scan, and repeated searches are faster thanks to in-memory file content caching.

### Improvements
- Clicking a usage-count CodeLens with `kotlinJump.smartNavigation` enabled now populates the Find Usages panel from the cached scan results instead of rescanning the workspace — the panel opens instantly rather than re-reading every file a second time.
- File content is now cached in memory across Find Usages calls within a session, so repeated searches on the same files avoid redundant disk reads on large codebases.
- Find Usages now correctly disambiguates member symbols — enum entries, companion constants, and similarly named members in different classes — by checking which parent class is visible in the calling file, reducing false positives in search results.
- Editing a file now triggers surgical CodeLens cache eviction: only the usage counts for symbols defined in the changed file are invalidated and recomputed, rather than clearing the entire cache on every save.

### Notes
- New adversarial, invariant, and performance regression test suites were added for the symbol indexer and word index. These are internal but directly increase confidence that navigation results remain correct and fast as the codebase evolves.

## 1.3.0

Adds string resource hover tooltips and a one-click editor title bar toggle for string folding in Kotlin and Java files.

### Improvements
- Added hover tooltips for R.string.* references — hovering over a resource reference now shows its resolved string value from strings.xml, so you can inspect resource values without switching files.
- Added string folding toggle buttons to the editor title bar — an eye icon appears for open Kotlin and Java files, letting you enable or disable string resource folding with a single click rather than through the command palette or settings. The icon updates to reflect the current folding state.

## 1.2.0

Adds R.string.* resource value folding — inline string previews directly in Kotlin source, no language server required.

### Improvements
- Added string resource folding: `R.string.foo` references are replaced inline with their actual string values from `strings.xml`, matching Android Studio's Resource Value Folding behaviour. The real code reappears when your cursor is on the line.
- String value overlays use the editor's string literal colour for visual consistency.
- Watches `**/res/values*/strings.xml` for changes and reloads automatically. Toggle with `kotlinJump.stringResourceFolding` (enabled by default).

## 1.1.0

Adds inferred-type inlay hints enabled by default and overhauled parameter-name hints.

### Improvements
- Added inferred-type inlay hints: variable and expression types now appear inline as you write Kotlin and Java code, so you can follow code flow without manually tracing declarations. Enabled by default; toggle with `kotlinJump.inlayHints.inferredTypes`.
- Overhauled parameter-name hints — the underlying logic was rewritten for better accuracy, with hints appearing in more valid cases and fewer false positives.

### Notes
- Removed residual `.wasm` artifacts from the VSIX package, keeping the installed extension clean following the parser removal in 1.0.2.

## 1.0.2

Removes the WASM tree-sitter dependency, shrinking the extension and eliminating a startup cost with no change to features or navigation behavior.

### Improvements
- Removed the bundled WASM tree-sitter parser and its ~3 MB dependency — the extension is smaller to install and activates faster. All navigation features continue to use the regex parser, which is 109× faster than the WASM alternative.

### Notes
- No commands, settings, or navigation behaviors have changed in this release.

## 1.0.1

Patch release with expanded test coverage and source updates across the parser, indexer, MCP server, and AI integration layers; no new commands or settings.

### Notes
- Source changes were made to the Kotlin and Java parsers, symbol indexer, MCP server, chat participant, and signature utilities — no new commands or settings were introduced.
- The test suite was substantially expanded: new adversarial and edge-case test files were added covering the Kotlin parser, Java parser, MCP server, chat participant, and KDoc extraction, increasing confidence in correctness across edge conditions.
- No functional changes to commands, settings, or extension behaviour are documented for this release beyond what is reflected in the source modifications above.

## 1.0.0

Kotlin Jump 1.0.0 adds a VS Code chat participant, an MCP server for external AI tool integration, and a native JUnit test runner.

### Improvements
- Added a chat participant for VS Code's built-in chat panel — use `/search`, `/usages`, `/implementations`, and `/doc` to query your Kotlin codebase in natural language, powered by the extension's own symbol index, without leaving the editor.
- Added an MCP server: AI assistants that support the Model Context Protocol (e.g. Claude Desktop) can now query Kotlin Jump's symbol index directly for code navigation and documentation lookup from outside VS Code.
- Added a native test runner: JUnit 4 and 5 tests now appear in VS Code's Test Explorer with full run and debug support via Gradle — no separate test plugin required. Annotations are detected automatically during indexing.

### Fixes
- Fixed navigation across submodules in multi-module Gradle projects that use Groovy-style `include` syntax — affected projects no longer fail to resolve cross-module symbols.

### Notes
- This release requires VS Code 1.115.0 or later (previously 1.102.0). Update VS Code before upgrading the extension.

Kotlin Jump 1.0.0 adds an AI chat participant, an MCP server for external AI tool integration, and a native VS Code test runner for JUnit tests.

### Fixes
- Fixed module resolution failing in multi-module Gradle projects that use Groovy-style `include` syntax — navigation across submodules now works correctly in these projects.

### New Features
- Added a Kotlin Jump chat participant — use `/search`, `/usages`, `/implementations`, and `/doc` in VS Code's chat panel to query your Kotlin codebase in natural language, powered by the extension's own symbol index.
- Added an MCP server: AI assistants that support the Model Context Protocol (e.g. Claude Desktop) can now query Kotlin Jump's symbol index directly, enabling code navigation and documentation lookup from outside VS Code.
- Added a native test runner: JUnit tests now appear in VS Code's Test Explorer with full run and debug support, driven by Gradle — no separate test plugin required. JUnit 4/5 annotations are detected automatically during indexing.

## 0.10.0

Adds symbol-aware code folding and smart selection expansion for Kotlin files.

### Improvements
- Added symbol-aware code folding for Kotlin files — classes, functions, the import block, and KDoc comments now fold as discrete units, replacing VS Code's indentation-based folding which can misalign on Kotlin syntax.
- Added smart selection ranges: expanding or shrinking the selection (Shift+Alt+Right / Shift+Alt+Left) now follows Kotlin symbol boundaries instead of relying on generic bracket matching.
- Folding can be disabled per-workspace with the new `kotlinJump.foldingEnabled` setting.

## 0.9.0

Adds inlay hints and signature help, and fixes false positives in Find Usages and symbol indexing.

### Improvements
- Added inlay hints: parameter names and inferred types now appear inline as you write Kotlin and Java code, reducing the need to look up function signatures separately.
- Added signature help: invoking a function now shows an active-parameter popup with the full signature, making it easier to fill in arguments without leaving the editor.

### Fixes
- Fixed Find Usages returning false positives — symbol names appearing inside comments or as substrings of unrelated identifiers no longer show up in the usages list.
- Fixed symbol indexing bugs in the Kotlin parser that could cause Go to Definition or Find Usages to miss symbols or resolve to the wrong declaration.

## 0.8.0

Adds auto-import suggestions and document highlight support for Kotlin and Java symbols.

### Improvements
- Added auto-import support: the extension now suggests and inserts the correct import statement when you use an unimported Kotlin or Java symbol, with no language server required. Can be toggled with `kotlinJump.autoImport.enabled`.
- Added document highlight support: placing the cursor on a symbol now highlights all its occurrences in the current file, making it easier to track local usages at a glance.

## 0.7.8

Adds Go to Definition and KDoc for library symbols by indexing sources JARs from Gradle and Maven caches.

### Improvements
- Go to Definition and KDoc now work for library symbols — Compose, Coroutines, AndroidX, and any dependency with a -sources.jar in your Gradle or Maven cache — without a language server.
- Source files inside JARs can now be opened directly in the editor, letting you read library source code when navigating to a library symbol.
- Added kotlinJump.useGradleTooling to resolve source JARs via ./gradlew instead of scanning the full Gradle cache — indexes only the project's actual dependencies, producing a smaller and more targeted index at the cost of a slower first run.

### Notes
- Library source indexing is on by default and capped at 50 JARs each for Gradle and Maven caches; adjust the limits with kotlinJump.sourcesJarsMaxCount and kotlinJump.mavenSourcesMaxCount, or override cache paths via kotlinJump.gradleCacheDir and kotlinJump.mavenLocalRepoDir.

## 0.7.7

Adds Move File and Organize Imports commands for Kotlin and Java files.

### Improvements
- Added a Move File command for Kotlin files, accessible from the editor right-click menu — lets you move or rename a Kotlin file directly from the editor without switching to the file explorer.
- Added an Organize Imports command (Shift+Alt+O) for Kotlin and Java files — removes unused imports using a heuristic that checks whether the imported name or alias appears in the file body; wildcard imports are always kept. Available from the command palette and the editor right-click menu.
- Added a kotlinJump.organizeImports.removeUnused setting (enabled by default) to opt out of unused-import removal while still running the Organize Imports command.

## 0.7.6

Adds a Move File command for Kotlin files, available from the editor context menu.

### Improvements
- Added a Move File command ("Move File…") for Kotlin files, accessible from the editor right-click menu — lets you move or rename a Kotlin file directly from the editor without leaving the keyboard.

Adds an Organize Imports command for Kotlin and Java files.

### Improvements
- Added Organize Imports command (Shift+Alt+O) for Kotlin and Java files — removes unused imports using a heuristic that checks whether the imported name or alias appears in the file body; wildcard imports are always kept. Available from the command palette and the editor right-click menu.
- Added kotlinJump.organizeImports.removeUnused setting (enabled by default) to opt out of unused-import removal while still running the Organize Imports command.

## 0.7.5

Expands Java method indexing and fixes two navigation edge cases in Call Hierarchy and Go to Definition.

### Improvements
- Java methods with package-private visibility (no explicit access modifier) are now indexed when their return type is void, a primitive, or an uppercase-named class, filling a coverage gap in Go to Definition and Find Usages for mixed Kotlin/Java projects.

### Fixes
- Fixed Call Hierarchy silently dropping outgoing calls from inline functions with block bodies (e.g., `inline fun f() { call() }`); all calls inside those bodies now appear correctly in the outgoing Call Hierarchy panel.
- Fixed Go to Definition returning the wrong result when a wildcard import and an explicit import both provide the same simple name; the explicit import now correctly wins the tiebreak instead of resolving to an unintended symbol.

## 0.7.4

Extends Java navigation to methods, fields, and enum entries, and fixes Go to Definition false positives for library symbols.

### Improvements
- Java methods, fields, and enum entries are now indexed, making Go to Definition and Find Usages work for individual Java members — not just class declarations — in mixed Kotlin/Java projects.

### Fixes
- Fixed Go to Definition returning false results when the cursor is on a symbol that resolves to an unindexed library class; the extension now correctly declines to navigate rather than jumping to an unrelated location.
- Fixed Kotlin enum indexing so enums with multiple entries are fully indexed, and corrected a parser edge case that could cause class-level declarations preceding an enum to be missed.

## 0.7.3

Fixes Find Usages false positives for private symbols, sharpens Go to Definition when same-named symbols coexist in the same package, and speeds up workspace symbol search with a trigram prefilter.

### Improvements
- Workspace symbol search (⌘T / Ctrl+T) now uses a trigram prefilter for queries of three or more characters, shrinking the fuzzy-match candidate pool before scoring and making symbol lookup noticeably faster in large projects.
- Startup phases, per-file scan timings, and search query durations are now written to the "Kotlin Jump" Output channel, making it easier to diagnose slow indexing or unexpected behavior without filing a bug report.

### Fixes
- Fixed Find Usages returning results from unrelated files when the target symbol is declared `private`; searches are now restricted to the declaring file, eliminating false positives that appeared when multiple classes in the same package each defined a same-named private member (e.g., `private val clickStream` repeated across ViewModels).
- Fixed Go to Definition presenting multiple ambiguous results when the cursor is inside a file that declares one of several same-package, same-named symbols; the declaration in the current file is now correctly preferred over same-package siblings.

## 0.7.2

Fixes incorrect CodeLens counts for same-named symbols, stale zero-counts after cancelled scans, Find Usages false positives from wildcard import collisions, and a WASM parser null-tree crash.

### Fixes
- Fixed CodeLens usage counts showing incorrect values when multiple classes define a symbol with the same simple name; counts now key on fully-qualified names so symbols in different classes no longer share a cache entry.
- Fixed CodeLens usage counts permanently displaying 0 after a scan is cancelled mid-flight; the stale result is now evicted so the next scan returns an accurate count.
- Fixed Find Usages returning false matches in files that use wildcard imports from multiple packages when those packages each export a different symbol with the same simple name; such references are now correctly treated as ambiguous and excluded.
- Fixed a potential crash in the WASM parser when tree-sitter returns a null parse tree; the error is now surfaced with a clear message instead of propagating as an unhandled exception.

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
