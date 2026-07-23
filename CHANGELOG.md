# Changelog

## 1.30.0

Kotlin Jump 1.30.0 adds a CodeLens that runs Gradle tasks directly from build.gradle.kts declarations.

### Improvements
- Added a CodeLens above Gradle task declarations in build.gradle.kts files, letting you run a task with one click right where it's defined.

### Notes
- No other functional changes in this release.

## 1.29.0

Kotlin Jump 1.29.0 adds inline hover tooltips that translate cron and ISO 8601 duration string literals into plain language.

### Improvements
- Added hover tooltips that translate cron expressions and ISO 8601 duration string literals (schedules, timeouts, delays) into plain language, right where you're reading the code.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.literalTooltips setting.

## 1.28.0

Kotlin Jump 1.28.0 flags deprecated Kotlin symbols with a strikethrough and shows the suggested replacement code directly on hover.

### Improvements
- Added strikethrough rendering for deprecated Kotlin symbols, making outdated APIs visible at a glance instead of requiring a manual check.
- Added a hover tooltip on deprecated symbols that shows the ReplaceWith snippet, so the suggested replacement is visible without navigating to the declaration.
- Available in both desktop VS Code and VS Code for the Web.

### Notes
- No other functional changes in this release.

## 1.27.0

Kotlin Jump 1.27.0 adds numbered step badges that show execution order on multi-line Kotlin Flow chains.

### Improvements
- Added numbered badges on multi-line Kotlin Flow chains, marking the order each operator executes so long chains are easier to read at a glance.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.flowChainBadges setting.

## 1.26.0

Kotlin Jump 1.26.0 adds inline accessibility hints for Jetpack Compose, flagging accessibility gaps directly in your UI code.

### Improvements
- Added inline hints that flag Jetpack Compose accessibility gaps right where you're writing UI code, making them easy to catch early instead of during a later review pass.
- Can be turned off via the kotlinJump.composeAccessibilityHints setting if you don't want the extra inline markers.

## 1.25.0

Kotlin Jump 1.25.0 adds hover tooltips that explain Android permissions directly in your code and in AndroidManifest.xml.

### Improvements
- Added hover tooltips for Android permissions covering 61 permissions, showing the protection level (normal, dangerous, or signature) and a plain-language description without leaving the editor.
- Included migration notes on legacy permissions such as WRITE_EXTERNAL_STORAGE, BLUETOOTH, and USE_FINGERPRINT, clarifying how they behave on newer Android versions.
- Extended hover support to AndroidManifest.xml, so permission entries there get the same tooltips as permission references in Kotlin code.

## 1.24.0

Kotlin Jump 1.24.0 highlights overdue dated TODO comments in red so stale work is easy to spot.

### Improvements
- Dated TODO comments that have passed their due date now render in red, making overdue work visible at a glance instead of requiring a manual scan through the file.
- Works in both desktop VS Code and VS Code for the Web.
- Can be toggled with the kotlinJump.todoExpiry setting.

## 1.23.1

Kotlin Jump 1.23.1 fixes a test explorer bug that could target the wrong test when files share the same fully qualified name.

### Fixes
- Fixed test run and debug targeting from the gutter and CodeLens: tests sharing the same fully qualified name across different files now each resolve to their own test instead of risking a mismatch.

## 1.23.0

Kotlin Jump 1.23.0 adds an optional rating prompt with editor-aware review links, plus a leaner package and a more reliable release pipeline.

### Improvements
- Added a rating prompt that appears after Kotlin Jump has been active for at least 10 sessions over a week, caps at three lifetime prompts, and honors "Don't ask again" permanently.
- Routed the rating prompt and the What's New panel's review link to the correct store for your editor: the VS Code Marketplace, or Open VSX for Cursor, Windsurf, VSCodium, and other forks.

### Packaging and Docs
- Excluded stray development tool artifacts, such as debug logs and session data, from the packaged extension, keeping installs clean.
- Hardened the automated web test suite by forcing headless Chromium, cutting spurious failures during release checks.

## 1.22.0

Kotlin Jump 1.22.0 brings Move File, bundled stdlib navigation, and drawable hover previews to VS Code for the Web, fixes test task overrides in multi-root workspaces, and adds automated web testing to the release process.

### Improvements
- Move File now works in VS Code for the Web, including package inference and import rewriting, instead of showing a "not available" message.
- The bundled Kotlin stdlib (List, String, Sequence, and the rest) now resolves from a prebuilt index shipped with the extension, so it works offline on the first file open, on both desktop and web.
- The drawable XML hover preview now works in web workspaces; the always-on gutter thumbnail stays desktop-only since it needs local disk access.
- Opening the Logcat panel or its device list in VS Code for the Web now shows a clear message pointing to desktop VS Code or a GitHub Codespace instead of a generic error.
- The README now documents exactly which features work in the browser versus which need a real machine behind the editor.

### Fixes
- Fixed `kotlinJump.testTaskOverrides` in multi-root workspaces: it now resolves from the module's own workspace folder instead of a single window-wide setting, so different Gradle modules apply their own overrides correctly.

### Packaging and Docs
- Added an automated test suite that runs the extension inside a real VS Code for the Web instance, catching browser-specific regressions before they reach a release.

## 1.21.2

Fixes a Logcat panel performance bug that could make VS Code as a whole feel sluggish during or after a debugging session, makes `kotlinJump.logcat.stop` actually stop the stream, and resolves the v1.21.0 Marketplace install failure.

### Fixes
- Fixed the Logcat webview's mirror buffer, which evicted rows with `Array.prototype.shift()`, an O(n) operation per row that ran on every incoming log line once the buffer filled, inside the webview's rendering process. Replaced with the same O(1) ring buffer already used on the extension host side.
- Fixed the webview's tag/search/level filter to update incrementally instead of rescanning the entire buffer on every batch of incoming lines (this ran at up to 60Hz while a filter was active).
- Fixed `kotlinJump.logcat.stop`, which only muted forwarding to the panel (`pause()`) without stopping the underlying `adb logcat` process. The stream, parsing, and stack-trace resolution kept running in the background indefinitely after a Stop. Stop now tears the stream down for real, and the status bar pill shows a distinct "Stopped" state.
- The ADB device watcher no longer starts unconditionally at extension activation. It now starts lazily, on first opening the Logcat panel, running a command that needs it, or a successful Android Run. A Kotlin file in the workspace no longer implies an always-on `adb` process for non-Android projects.
- The webview no longer keeps re-filtering and re-rendering while the Logcat panel is hidden; it resyncs in one pass when the panel becomes visible again.

### Notes
- v1.21.0 could fail to install from the Marketplace with a `PackageIntegrityCheckFailed` error: two Release workflow runs fired concurrently on that tag and each published its own build under the same version number, leaving a mismatched package signature. This release is a fresh, single-build publish and is unaffected.
- No changes to navigation, indexing, Gradle integration, or Android Run itself.

## 1.21.0

Adds a built-in Logcat panel with real-time ADB streaming, clickable stacktrace deeplinks, and automatic start on Android Run.

### Features
- Added a Logcat panel that streams ADB output from connected Android devices in a dedicated VS Code webview, removing the need to switch tools during development.
- Stack traces in the live stream render as clickable deeplinks; selecting a frame navigates to the exact file and line in your source.
- Logcat starts automatically when Android Run launches the app and follows its PID, so the panel shows only that app's output from the first moment.
- A status bar pill reflects the current stream state and provides one-click access to start, stop, pause, resume, clear, and device switching.
- A configurable ring buffer caps memory usage during long sessions; logs can be exported to a plain-text file for sharing or post-mortem analysis.

## 1.20.0

Adds a sealed `when` coverage CodeLens that shows branch coverage inline and inserts every missing case in one click. Works on sealed classes, sealed interfaces, and enums, on desktop and on vscode.dev.

### Features
- A CodeLens above every `when` over a sealed hierarchy or enum shows coverage at a glance: `✓ 3/3 branches` when exhaustive, `⚠ 2/3 branches, missing: Draw` when incomplete, and `✓ else covers 2 remaining` when an `else` hides unhandled subtypes.
- Clicking an incomplete lens inserts the missing branches with `TODO()` bodies. Insertion is kind-aware (bare name for objects and enum entries, `is` for classes) and mirrors the qualification style already used in the file. The cursor lands on the first inserted `TODO()`.
- No compiler involved: the hierarchy is recovered from the branches themselves through the import-aware resolver. When a branch is ambiguous or unresolved the lens stays silent rather than showing a wrong count. Kotlin 2.1+ guard branches (`is A if cond ->`) are recognized and correctly excluded from exhaustiveness.
- Toggle with `kotlinJump.sealedWhenCoverage` (on by default). Every analysis step and skip reason is traced as `[SealedWhen]` lines in the Kotlin Jump output channel.

### Fixes
- Enum entries written in UpperCamelCase are now indexed correctly: `enum class Screen { Home, Battle }` used to produce phantom one-letter symbols inline and drop the entries entirely in multi-line bodies, polluting Go to Symbol results.
- Fixed the column position of enum entries with constructor arguments, which produced overlapping semantic tokens in the editor.

## 1.19.0

Version 1.19.0 makes Kotlin Jump work on VS Code for the Web. Activation previously crashed on vscode.dev; the full pure JavaScript feature set now runs in the browser, verified end to end on a live web extension host.

### Improvements
- The browser build now registers everything that does not need Node.js: the editor toolbar toggles for string, color, and const val folding, hex swatches, and null assertion highlighting (with the Shift+Alt+I master toggle), the @Suppress hover, R.drawable hover thumbnails, the auto-opening vector drawable side preview with its references CodeLens, and clickable inlay hint navigation.
- A shared encoding utility now backs every byte-to-text conversion in code common to both hosts. Desktop keeps the zero-copy Buffer fast path; the web host uses TextDecoder and btoa with identical output, BOM handling included.
- Desktop-only commands (library sources download, Gradle detection) show a clear "Not available in VS Code for the Web" message instead of failing silently when invoked in the browser.
- Added a companion tools section to the README documenting detekt-lsp and SearchDeadCode as complementary Kotlin development tools.

### Fixes
- Fixed extension activation on vscode.dev: the parser worker pool read `__dirname` outside its fallback guard, which crashed activate() in the web worker before indexing could start.
- Fixed Find Usages, index snapshot persistence, and the What's New panel in the browser; all three relied on the Node-only Buffer global and threw on first use.
- Fixed viewport semantic highlighting in the browser: the range tokens provider scheduled its cache fill with Node-only setImmediate and failed on every freshly opened document.
- Fixed inlay hint navigation in the browser: the post-navigation suppression guard introduced in 1.18.3 was missing from the web entry, so jumping to a parameter from a hint opened the References peek on top of the destination.
- The vector preview references CodeLens provider is now disposed on deactivation, on desktop and web alike.

## 1.18.3

Adds plain-English hover for @Suppress codes, fixes Cmd+Click on inlay hints to jump to the parameter declaration rather than the function name, and standardizes all user-facing UI text.

### Improvements
- Hovering over a @Suppress, @SuppressLint, or @SuppressWarnings code now displays a plain-English description of what that suppression disables, with coverage for Kotlin compiler diagnostics, Android Lint checks, and Java warnings.
- Cmd+Click on a parameter inlay hint now resolves to the correct parameter declaration rather than the function or constructor name, making navigation from call sites precise.
- All user-facing strings in tooltips, quick-pick labels, status bar text, and menu items were standardized for consistent, clean prose across the extension.

### Notes
- The in-editor walkthrough now mentions KDoc hover, the string locale grid, and suspend call markers in existing steps, making those features easier to discover after install.
- The Marketplace and Open VSX display name was updated to include Android Studio to improve search discoverability for Android developers.
- No changes to indexing, code folding, Gradle integration, Android Run, or Find Usages behavior since v1.18.2.

## 1.18.2

Drawable gutter thumbnails now refresh reliably when files are edited or saved.

### Fixes
- Fixed drawable gutter thumbnails to refresh reliably on every file edit and save, so the preview in the gutter always reflects the current state of the drawable.

### Notes
- No changes to navigation, indexing, code folding, inlay hints, Gradle integration, or any other feature since v1.18.1.

## 1.18.1

Improves Gradle project root detection across all workspace layouts, adds automatic Windows wrapper fallback, and sharpens settings documentation for non-standard configurations.

### Improvements
- Gradle root detection walks up from the active editor and stops at the first settings.gradle(.kts), treating a standalone build.gradle as a provisional fallback only when no settings file exists higher up the tree. The same rule Gradle itself uses.
- On Windows, the gradlew wrapper resolver tries gradlew.bat before the bare script, so no manual kotlinJump.gradleWrapper change is needed on that platform.
- When detection finds more than one Gradle root in the workspace, a QuickPick prompt appears; the chosen project is remembered for the session and used by both Test Explorer and Android Run.
- The Android Run status bar button now shows four actionable states (resolved, ambiguous, setting-invalid, and wrapper-missing) each with a tooltip and a command that opens the relevant fix.

### Notes
- No changes to navigation, indexing, code folding, inlay hints, or any other non-Gradle feature since v1.18.0.

### Settings Documentation
- kotlinJump.gradleWrapper now documents that the path is relative to the detected gradleProjectRoot, not the workspace folder, preventing a common misconfiguration.
- kotlinJump.gradleProjectRoot now includes explicit guidance for sub-module layouts (e.g. opening app/ instead of the project root), flat-style projects (e.g. master/), and a clearer description of how auto-detection tiers work.

## 1.18.0

Kotlin Jump 1.18.0 adds live vector drawable previews with gutter thumbnails, hover, CodeLens, and a side panel, brings hex color swatches to XML resource files, and ships multi-phase startup and memory performance improvements alongside a batch of precision fixes.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.18.0/media/demos/vector-preview.webp" width="720" alt="Vector Drawable Preview" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.18.0/media/demos/private-file-isolation.webp" width="720" alt="File-Private Isolation in Find Usages" />
</p>

### Improvements
- Index snapshots are now written as gzip-compressed files, reducing disk I/O and cutting the time to restore a warm index on subsequent startups.
- Eliminated per-document allocations in the parser hot path and interned repeated kind and supertype strings to reduce GC pressure on large projects.
- Widened stat concurrency during the initial scan, improved trigram cache hit rate, and cached hot regex and path lookups in the usages engine to reduce repeated-search latency.

### Fixes
- Fixed the vector preview CodeLens to remain clickable after first activation; the references panel now closes automatically when a reference is picked.
- Fixed R.drawable.<name> usage search to scan the full workspace directly, so the reference count shown in the CodeLens is accurate.
- Fixed color folding to skip <color> tags inside XML comments, and fixed @color/X resolution to scan every values*/*.xml folder including locale and variant directories.
- Fixed folding decorations for R.plurals and R.array to use distinct visuals so they are no longer confused with R.string.
- Fixed Find Usages to correctly isolate file-private symbols, fixed const-val folding to respect block comments, and fixed plurals indexing to cover all values*.xml files.

## 1.17.10

Fixes null assertion highlighting to exclude Java files, where !! is a boolean double-negation, not a Kotlin null-assertion operator.

### Fixes
- Null assertion highlighting (!! operator) no longer triggers in Java files, where !! is a boolean double-negation rather than a null-assertion operator.

### Notes
- This is a focused single-fix release. No commands, settings, navigation behavior, or other UI changed since v1.17.9.

## 1.17.9

Fixes Cmd+Click on parameter inlay hints to navigate directly to the declaration without triggering the Find Usages panel as a side effect.

### Fixes
- Cmd+Click on a parameter inlay hint now performs navigation only. It jumps to the parameter declaration without also opening the Find Usages panel.

### Notes
- This is a focused single-fix release. No other commands, settings, navigation behavior, or UI changed since v1.17.8.

## 1.17.8

Fixes Cmd+Click on parameter inlay hints to navigate to the correct parameter declaration.

### Fixes
- Fixed Cmd+Click on parameter inlay hints. The action now navigates to the actual parameter declaration rather than resolving to the wrong symbol or doing nothing.

### Notes
- This is a focused single-fix release. No other commands, settings, navigation behavior, or UI changed since v1.17.7.

## 1.17.7

Removes em-dashes from the extension `displayName`, `description`, the in-VS Code "What's New" panel, and the supporting Markdown files. The Marketplace listing now reads in plain human punctuation across the title, tagline, and onboarding copy.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.6.
- `displayName` em-dash separator switched to a colon: `Kotlin Jump: Fast Kotlin & Android Navigation`.
- `description` em-dashes replaced with periods.
- `media/whats-new.json` and the supporting `ANDROID-SETUP.md` / `CONTRIBUTING.md` files cleaned in the same pass.

## 1.17.6

Removes 26 em-dashes from the README that gave the listing an AI-generated feel. Replaced with periods, commas, or sentence breaks depending on context. The copy now reads like a human wrote it.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.5.
- Pure copy edit: 26 em-dashes (`—`) replaced with natural punctuation.

## 1.17.5

README rewrite focused on conversion: removes redundant sections (Get Started, Performance, How it works, Build from source) that were duplicating header content or speaking to post-install audiences, condenses Android Run setup and Library Sources into tighter prose, kills the configuration jsonc dump, and trims emoji noise on section headings. Net result: ~30 % shorter for the same feature coverage, with a denser ratio of demos per scroll.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.4.
- README slimmed from 499 to ~355 lines (~43 % fewer words).
- Android monorepo / multi-flavor configuration moved to the new `ANDROID-SETUP.md`.
- Build-from-source instructions moved to the new `CONTRIBUTING.md`.
- "What's new" section renamed to "Recent" and refreshed with concrete labels (no version numbers in headings).

## 1.17.4

Removes the README "Limitations" section that was misrepresenting the extension's capabilities (it claimed "no full refactoring" while rename, move file, organize imports, and auto-import are all shipped) and was placed immediately before the rate/install CTAs, suppressing conversion at the worst possible moment.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.3.
- Removed README "Limitations" section. The single legitimate caveat (String folding is Android-only) is already stated in the String Resource Folding section itself, and completion guidance is covered by the Companion Mode section.

## 1.17.3

Fixes the broken Marketplace install/rating badges in the README and Marketplace listing. The previous shields.io endpoints were silently returning a "retired badge" placeholder. Migrated to the Microsoft-hosted vsmarketplacebadges.dev provider.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.2.
- Badge URLs migrated from `img.shields.io/visual-studio-marketplace/{i,r}/...` (deprecated) to `vsmarketplacebadges.dev/{installs-short,rating-short}/...` (Microsoft-hosted).

## 1.17.2

Marketplace metadata release. Refines the listing for better discoverability (description, keywords, categories, badges) and converts the README header for the migration cohort coming from Android Studio. No changes to extension commands, settings, navigation, or any user-facing behavior since v1.17.1.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.1.
- Updated Marketplace listing metadata (description, keywords, categories, qna, badges) to improve discoverability for the Android Kotlin developer cohort.
- Refreshed README hero and added a rate CTA; reordered features to surface Android-specific capabilities earlier.

## 1.17.1

Fixes local-scope handling across six providers, adds a declaration-to-usages jump, corrects code lens behavior, and improves const-val folding performance.

### Improvements
- Const-val folding decorations are now cached by document version and lookups are memoized, eliminating scroll lag on large files.
- Local scope resolution now checks function parameters and block-level bindings before falling back to the workspace index, improving definition accuracy throughout.

### Fixes
- Rename and hover providers now recognize local variables and parameters, preventing workspace-wide symbol rewrites when renaming a local and showing accurate hover information.
- Go to Definition on a plain string literal or comment text no longer returns a spurious result.
- Named-argument left-hand sides (e.g., `name =` in a function call) now resolve to the correct parameter declaration.
- Navigation history Back command preserves the cursor column; Forward remains available after navigating across files.
- The const-val folding provider no longer folds the identifier on the declaration line of a val or var.

## 1.17.0

1.17.0 adds drawable resource previews. Hover over any R.drawable reference to see a rendered thumbnail tooltip, and VectorDrawable XML is converted to SVG so both raster and vector assets display correctly.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.17.0/media/demos/drawable-hover.webp" width="720" alt="Gutter Drawable Thumbnails" />
</p>

### Fixes
- Fixed the What's New panel opening two VS Code windows instead of one when previewing release notes.
- Fixed the What's New panel loading stale content; the webview now reads the current release JSON on every open.

### Features
- Added drawable resource indexing that tracks all res/drawable entries across density qualifiers and reacts to file changes in real time.
- Added a hover provider for R.drawable references that renders a thumbnail preview. VectorDrawable XML files are converted to SVG inline, so no external renderer is needed.
- Added gutter thumbnail decorations alongside any line that references a drawable resource, giving a persistent visual cue without opening the asset file.

## 1.16.1

Maintenance patch correcting v1.16.0 release note text and version references; no changes to extension functionality.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.16.0.

## 1.16.0

Version 1.16.0 adds hover documentation for suppression annotations, dispatcher-aware inlay badges on coroutine suspend calls, and default keyboard shortcuts for common navigation and editor actions.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.16.0/media/demos/suppress-hover.webp" width="720" alt="Hover tooltip showing a plain-English explanation of a suppression ID" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.16.0/media/demos/suspend-call-marker.webp" width="720" alt="Suspend call markers with dispatcher badges inline" />
</p>

### Features
- Added hover documentation for @Suppress, @SuppressLint, and @SuppressWarnings annotation IDs. Hovering over a suppression string shows a plain-English description of the warning or lint check being silenced.
- Added dispatcher-specific inlay badges to coroutine builder calls that specify a dispatcher (e.g. Dispatchers.IO, Dispatchers.Main), so dispatched suspension points are visually distinct from plain suspend calls at a glance.
- Registered default keyboard shortcuts for: Find Usages (Alt+F7), Go to Test (Alt+Shift+T), Go to Composable Preview (Alt+Shift+P), Organize Imports (Shift+Alt+O), Rename (Ctrl/Cmd+R), Navigate Back/Forward (Ctrl/Cmd+Alt+←/→), Copy FQN (Shift+Alt+C), and Toggle Inline Features (Shift+Alt+I).

## 1.15.0

Adds a visual at-a-glance infographic to the marketplace listing; no changes to extension commands, settings, or navigation behavior.

### Improvements
- Added a visual infographic to the marketplace README to give users an at-a-glance overview of the extension's features before installing.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.14.1.

## 1.14.1

v1.14.1 reduces the extension download size by approximately 30 MB by removing nine unused walkthrough GIFs, and sharpens the built-in Library Sources walkthrough step with a more realistic example.

### Improvements
- Removed nine unused GIF files from the extension package, reducing the VSIX download size by approximately 30 MB.
- Updated the Library Sources step in the built-in walkthrough to demonstrate the feature with a coroutines library jar, making the guided example more accurate and realistic for new users.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.14.0.

## 1.14.0

v1.14.0 updates the built-in walkthrough for accuracy and ships no changes to navigation, commands, or settings.

### Improvements
- Updated the inlay hints step in the built-in walkthrough to match current extension behavior, keeping the guided introduction accurate for new users.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.13.0.

## 1.13.0

v1.13.0 improves navigation accuracy for standard Kotlin and Java built-in types, and adds correct expect/actual resolution for Kotlin Multiplatform projects.

### Improvements
- Added implicit default import awareness for Kotlin (kotlin.*, kotlin.collections.*, kotlin.io.*, and related packages) and Java (java.lang.*). Go to Definition now works on built-in types that appear without an import statement.
- Added expect/actual modifier support for Kotlin Multiplatform projects; FQN lookups now prefer the actual declaration, giving more precise jump targets in multi-platform codebases.

## 1.12.1

Packaging fix. Reduces VSIX size by excluding demo capture artifacts that were accidentally shipped in 1.12.0.

### Fixes
- Excluded `tmp-demo-e2e/` and `tmp-demo-frames/` from the published VSIX. These directories are gitignored but were missing from `.vscodeignore`, inflating the package by ~19 MB with demo capture artifacts that have no runtime purpose.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.12.0.

## 1.12.0

**Library sources, reproducible everywhere. No JVM, no LSP, no setup.**

- **Bundled Kotlin stdlib** (~600 KB shipped). `List`, `String`, `Sequence`, etc. navigable from minute zero, even on a cold Gradle cache or offline. Project-pinned versions take precedence when present.
- **JDK source indexing**. `java.lang.*`, `java.util.*` and the rest of the JDK become navigable via `JAVA_HOME` auto-detection (macOS `/usr/libexec/java_home`, Linux `update-alternatives`, Windows scan). Multi-JDK aware (prefers JDK 17+).
- **HTTP source download**. When a library's `-sources.jar` is missing from the local cache, click the new **`$(library)` status bar item** → "Download missing sources". Direct HTTPS fetch from Maven Central. No `./gradlew dependencies`, no JVM, no terminal.
- **Status bar UX**. Dedicated item showing indexed-libs count, JDK badge, stdlib badge, missing count. Click for an actions menu.
- **Inline-feature toolbar buttons**. Five new editor-toolbar buttons (color folding, const val folding, hex color swatches, !! highlight, master `$(layers)` toggle) join the existing string-folding 👁 button.
- **6 new settings**. `kotlinJump.jdkHome`, `kotlinJump.useBundledStdlib`, `kotlinJump.suppressFirstScanPrompt`, `kotlinJump.fallbackToOnlineDocs`, plus the per-feature toggles. All have sensible defaults.

Backward-compatible: existing settings (`gradleCacheDir`, `indexSourcesJars`, `companionMode`) are respected.

## 1.11.0

Maintenance release with no changes to extension behavior. Corrects duplicate changelog entries and hardens the release pipeline for more reliable future publishes.

### Fixes
- Removed duplicate changelog sections for v1.7.0, v1.0.0, and v0.7.6 that were incorrectly present in the published history.
- Release script now validates that no matching tag already exists before proceeding, preventing accidental double-publishes.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.10.0.
- This release corrects the published changelog and improves release infrastructure only.

## 1.10.0

Kotlin Jump 1.10.0 adds Android Studio-style navigation history, inline resource diagnostics for broken R references, and a richer set of Kotlin and Android code insights.

### Improvements
- Added Android Studio-style navigation history with Back, Forward, and Clear History commands, making it easier to retrace jumps between definitions, implementations, and usages.
- Added resource diagnostics that flag unresolved R.string and R.color references inline, exposing broken Android resource lookups directly in the editor without running a build.
- Added const val folding, suspend call markers, version catalog hover, override/implement gutter indicators, and R.color resource folding for richer in-editor context on Kotlin and Android projects.

### Fixes
- Fixed Go to Class Implementation and related navigation commands so they register reliably and open the target editor correctly during navigation flows.
- Fixed parser, definition, and hover edge cases involving string interpolation, Android R.type.name references, inherited properties, and same-file symbol resolution.

### Notes
- Added a dedicated browser entrypoint with browser-safe stubs, bringing web-hosted installs closer to feature parity with the desktop extension for supported features.
- Expanded the CI test suite with a comprehensive real-world Kotlin/Android project covering coroutines, sealed classes, annotations, resource files, and multiple test frameworks. Improving confidence in parser correctness across a wider range of code patterns.

## 1.9.1

Maintenance release that resyncs package-lock.json with npm@10 for consistent CI builds; no changes to extension behavior, commands, or settings.

### Notes
- No changes to extension commands, settings, or navigation behavior since v1.9.0.
- Updated manual install instructions in the README to reference the 1.9.1 package.

### Packaging
- Resynced package-lock.json with npm@10 to prevent lock file drift and ensure reproducible CI builds.

## 1.9.0

Adds wireless Android device connection and pairing via mDNS, and reduces annotation scan CPU overhead with incremental processing.

### Improvements
- Added a Connect via ADB WiFi command that uses mDNS (dns-sd) to discover Android devices on the local network and connects wirelessly. Removes the need for a USB cable after first setup.
- Added a Pair via ADB WiFi flow with guided step-by-step instructions for first-time wireless pairing.
- HexColorFoldingProvider and NullAssertionProvider now perform incremental line scanning. Only lines that changed are reprocessed on each edit, reducing CPU overhead in files with many annotations.

### Fixes
- Fixed a race condition where ADB WiFi connection failed because IP resolution had not yet completed. The extension now connects using the stable .local mDNS hostname.
- Fixed device detection to prefer the HOST:PORT address format and fall back to the adb-XXXX-YYYY serial, preventing misidentified or dropped device connections.

## 1.8.0

Adds wireless ADB connection and pairing from VS Code, fixes device detection reliability, and reduces CPU overhead during editing with incremental annotation scanning.

### Improvements
- Added a Connect via ADB WiFi command that discovers Android devices on the local network using mDNS (dns-sd) and connects wirelessly. Removes the need for a USB cable after first setup.
- Added a guided Pair via ADB WiFi flow with step-by-step instructions for first-time wireless pairing, so the process works even without prior adb experience.
- HexColorFoldingProvider and NullAssertionProvider now perform incremental line scanning. Only lines that changed are reprocessed on each edit, cutting CPU overhead in files with many annotations.

### Fixes
- Fixed a race condition where ADB WiFi connection failed because IP address resolution had not completed. The extension now connects using the stable .local mDNS hostname instead.
- Fixed device detection to prefer the HOST:PORT address format and fall back to the adb-XXXX-YYYY serial, preventing misidentified or dropped device connections.

## 1.7.1

Version 1.7.1 reduces CPU overhead during active editing by debouncing decoration scans and caching per-document symbol lookups in semantic highlighting.

### Notes
- No new commands, settings, or navigation features in this release. All changes are performance and reliability improvements to existing visual annotations.
- Adversarial and performance test suites were added for the affected providers, increasing confidence that decoration and semantic highlighting remain correct under edge conditions.

### Performance
- Debounced keystroke-driven scans in NullAssertionProvider, HexColorFoldingProvider, and StringResourceFoldingProvider. Rapid typing no longer triggers a full document scan on every character.
- Added a per-document word cache in SemanticTokensProvider so symbols that appear multiple times in the same file are resolved only once per render pass.

## 1.6.1

1.6.1 adds a one-click Android Run button, visual Kotlin code annotations (hex swatches, !! highlighting, @RequiresApi hints), extended string resource intelligence, and extends availability to VS Codium via the Open VSX Registry.

### Improvements
- Added a Run button to the status bar that builds, installs, and launches the Android app on the connected device or emulator in one click. No terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task, supports multi-flavor and multi-app projects via `kotlinJump.androidProjects`, and offers to boot an AVD if no device is connected.
- Added hex color swatches alongside color literals in Kotlin and Java files so color values are visible without a separate color picker.
- Added highlighting for !! null-assertion operators to make unsafe dereferences immediately visible during code review.
- Added @RequiresApi inlay hints, R.plurals and R.array folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed extension activation failure on VS Code versions predating 1.87, where an unguarded vscode.chat API call prevented the extension from loading entirely.

### Packaging and Docs
- Published to the Open VSX Registry. Kotlin Jump is now available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

## 1.7.0

Kotlin Jump 1.7.0 adds a one-click Android Run button, visual code annotations for hex colors and null assertions, richer string resource intelligence, and fixes a crash that prevented loading on older VS Code versions.

### Improvements
- Added a Run button in the status bar that builds, installs, and launches an Android app on the connected device or emulator in one click. No terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task; supports multi-flavor and multi-app workspaces via `kotlinJump.androidProjects`; offers to start an AVD if no device is connected, so the first Run click always works.
- Added hex color swatches alongside color literals in Kotlin and Java files, making color values visible without a separate color picker.
- Added highlighting for `!!` null-assertion operators so unsafe dereferences stand out immediately during code review.
- Added `@RequiresApi` inlay hints, `R.plurals` and `R.array` folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed an activation failure on VS Code versions predating 1.87, where an unguarded `vscode.chat` API call prevented the extension from loading entirely.

### Packaging and Docs
- Kotlin Jump is now published to the Open VSX Registry. Available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

## 1.6.0

1.6.0 ships instant XML↔Kotlin string resource navigation via a pre-built index and fixes KDoc hover at declaration sites.

### Improvements
- Replaced per-navigation file scanning with a pre-built RResourceIndex, making jumps from R.string.* references to their XML definitions (and back) instant regardless of how many resource files the project contains.
- Added two-way string resource navigation: jump from an R.string.* reference in Kotlin or Java to its XML definition, and from an XML string entry back to all Kotlin and Java usages.

### Fixes
- Suppressed KDoc hover at a symbol's own declaration site, where it was redundant and visually noisy.
- Fixed base method lookup depth in KDoc resolution. Hover now correctly surfaces inherited documentation from the nearest supertype rather than stopping prematurely.

### Notes
- Added adversarial test suites covering navigation providers, the hover provider, and the resource index. These are internal but directly increase confidence that navigation results remain correct across malformed inputs and edge conditions.

## 1.5.1

Documentation-only release: the README was fully rewritten with complete feature coverage, updated copy, and eight animated GIFs. No changes to extension behavior.

### Notes
- No changes to extension behavior, commands, settings, parsing, or navigation logic. This release is documentation only.

### Packaging and Docs
- Rewrote the README with complete, accurate coverage of all major features: Go to Definition, Find Usages, Code Lens, Test Navigation, onboarding walkthrough, AI assistant, String Folding, and Inlay Hints.
- Added eight animated GIFs to the README (one per feature area) so users can see each capability in action before installing.
- Added dedicated sections for the Code Lens, walkthrough, and AI assistant features, which lacked dedicated documentation in previous versions.

## 1.5.0

1.5.0 ships an interactive 8-step onboarding walkthrough and fixes a cluster of Go to Implementation, Code Lens, and Find Usages accuracy issues.

### Improvements
- Added an 8-step interactive walkthrough that opens automatically on first install; each step includes an animated demo covering Go to Definition, Find Usages, Code Lens, Test Navigation, String Folding, Inlay Hints, and the AI assistant. Reopen anytime with "Kotlin Jump: Open Walkthrough" from the command palette.

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
- Type hierarchy subtypes are now sorted by kind (interfaces first, then sealed, concrete, data classes, objects, and enums) and each subtype item shows how many parent methods it overrides (e.g. "overrides 2/5"). Sealed class lists show an exhaustive count ("3/3 exhaustive").
- Implementation counts in CodeLens and type hierarchy now apply a same-name collision guard, preventing inflated counts when identically named classes exist in different packages.
- Import aliases (e.g. `import com.example.Foo as Bar`) are now recognized in symbol resolution. Navigation and rename work correctly when the alias name is used in code.
- Rename now uses import context to identify the precise class declaration when multiple classes share the same simple name, preventing the wrong .kt file from being renamed.

### Fixes
- Call hierarchy outgoing calls now include functions called inside expression-body (`fun f() = expr`) and inline-block (`fun f() { call() }`) declarations, which were previously not scanned.

### Notes
- Ten new adversarial and fuzz test suites were added covering call hierarchy, code lens, import resolution, the Java and Kotlin parsers, rename, symbol index, type hierarchy, and organize imports. Increasing confidence in correctness across edge conditions.

## 1.4.0

Clicking a usage-count CodeLens now opens the Find Usages panel immediately by reusing the already-computed scan, and repeated searches are faster thanks to in-memory file content caching.

### Improvements
- Clicking a usage-count CodeLens with `kotlinJump.smartNavigation` enabled now populates the Find Usages panel from the cached scan results instead of rescanning the workspace. The panel opens instantly rather than re-reading every file a second time.
- File content is now cached in memory across Find Usages calls within a session, so repeated searches on the same files avoid redundant disk reads on large codebases.
- Find Usages now correctly disambiguates member symbols. Enum entries, companion constants, and similarly named members in different classes. By checking which parent class is visible in the calling file, reducing false positives in search results.
- Editing a file now triggers surgical CodeLens cache eviction: only the usage counts for symbols defined in the changed file are invalidated and recomputed, rather than clearing the entire cache on every save.

### Notes
- New adversarial, invariant, and performance regression test suites were added for the symbol indexer and word index. These are internal but directly increase confidence that navigation results remain correct and fast as the codebase evolves.

## 1.3.0

Adds string resource hover tooltips and a one-click editor title bar toggle for string folding in Kotlin and Java files.

### Improvements
- Added hover tooltips for R.string.* references. Hovering over a resource reference now shows its resolved string value from strings.xml, so you can inspect resource values without switching files.
- Added string folding toggle buttons to the editor title bar. An eye icon appears for open Kotlin and Java files, letting you enable or disable string resource folding with a single click rather than through the command palette or settings. The icon updates to reflect the current folding state.

## 1.2.0

Adds R.string.* resource value folding. Inline string previews directly in Kotlin source, no language server required.

### Improvements
- Added string resource folding: `R.string.foo` references are replaced inline with their actual string values from `strings.xml`, matching Android Studio's Resource Value Folding behaviour. The real code reappears when your cursor is on the line.
- String value overlays use the editor's string literal colour for visual consistency.
- Watches `**/res/values*/strings.xml` for changes and reloads automatically. Toggle with `kotlinJump.stringResourceFolding` (enabled by default).

## 1.1.0

Adds inferred-type inlay hints enabled by default and overhauled parameter-name hints.

### Improvements
- Added inferred-type inlay hints: variable and expression types now appear inline as you write Kotlin and Java code, so you can follow code flow without manually tracing declarations. Enabled by default; toggle with `kotlinJump.inlayHints.inferredTypes`.
- Overhauled parameter-name hints. The underlying logic was rewritten for better accuracy, with hints appearing in more valid cases and fewer false positives.

### Notes
- Removed residual `.wasm` artifacts from the VSIX package, keeping the installed extension clean following the parser removal in 1.0.2.

## 1.0.2

Removes the WASM tree-sitter dependency, shrinking the extension and eliminating a startup cost with no change to features or navigation behavior.

### Improvements
- Removed the bundled WASM tree-sitter parser and its ~3 MB dependency. The extension is smaller to install and activates faster. All navigation features continue to use the regex parser, which is 109× faster than the WASM alternative.

### Notes
- No commands, settings, or navigation behaviors have changed in this release.

## 1.0.1

Patch release with expanded test coverage and source updates across the parser, indexer, MCP server, and AI integration layers; no new commands or settings.

### Notes
- Source changes were made to the Kotlin and Java parsers, symbol indexer, MCP server, chat participant, and signature utilities. No new commands or settings were introduced.
- The test suite was substantially expanded: new adversarial and edge-case test files were added covering the Kotlin parser, Java parser, MCP server, chat participant, and KDoc extraction, increasing confidence in correctness across edge conditions.
- No functional changes to commands, settings, or extension behaviour are documented for this release beyond what is reflected in the source modifications above.

## 1.0.0

Kotlin Jump 1.0.0 adds a VS Code chat participant, an MCP server for external AI tool integration, and a native JUnit test runner.

### Improvements
- Added a chat participant for VS Code's built-in chat panel. Use `/search`, `/usages`, `/implementations`, and `/doc` to query your Kotlin codebase in natural language, powered by the extension's own symbol index, without leaving the editor.
- Added an MCP server: AI assistants that support the Model Context Protocol (e.g. Claude Desktop) can now query Kotlin Jump's symbol index directly for code navigation and documentation lookup from outside VS Code.
- Added a native test runner: JUnit 4 and 5 tests now appear in VS Code's Test Explorer with full run and debug support via Gradle. No separate test plugin required. Annotations are detected automatically during indexing.

### Fixes
- Fixed navigation across submodules in multi-module Gradle projects that use Groovy-style `include` syntax. Affected projects no longer fail to resolve cross-module symbols.

### Notes
- This release requires VS Code 1.115.0 or later (previously 1.102.0). Update VS Code before upgrading the extension.

## 0.10.0

Adds symbol-aware code folding and smart selection expansion for Kotlin files.

### Improvements
- Added symbol-aware code folding for Kotlin files. Classes, functions, the import block, and KDoc comments now fold as discrete units, replacing VS Code's indentation-based folding which can misalign on Kotlin syntax.
- Added smart selection ranges: expanding or shrinking the selection (Shift+Alt+Right / Shift+Alt+Left) now follows Kotlin symbol boundaries instead of relying on generic bracket matching.
- Folding can be disabled per-workspace with the new `kotlinJump.foldingEnabled` setting.

## 0.9.0

Adds inlay hints and signature help, and fixes false positives in Find Usages and symbol indexing.

### Improvements
- Added inlay hints: parameter names and inferred types now appear inline as you write Kotlin and Java code, reducing the need to look up function signatures separately.
- Added signature help: invoking a function now shows an active-parameter popup with the full signature, making it easier to fill in arguments without leaving the editor.

### Fixes
- Fixed Find Usages returning false positives. Symbol names appearing inside comments or as substrings of unrelated identifiers no longer show up in the usages list.
- Fixed symbol indexing bugs in the Kotlin parser that could cause Go to Definition or Find Usages to miss symbols or resolve to the wrong declaration.

## 0.8.0

Adds auto-import suggestions and document highlight support for Kotlin and Java symbols.

### Improvements
- Added auto-import support: the extension now suggests and inserts the correct import statement when you use an unimported Kotlin or Java symbol, with no language server required. Can be toggled with `kotlinJump.autoImport.enabled`.
- Added document highlight support: placing the cursor on a symbol now highlights all its occurrences in the current file, making it easier to track local usages at a glance.

## 0.7.8

Adds Go to Definition and KDoc for library symbols by indexing sources JARs from Gradle and Maven caches.

### Improvements
- Go to Definition and KDoc now work for library symbols. Compose, Coroutines, AndroidX, and any dependency with a -sources.jar in your Gradle or Maven cache. Without a language server.
- Source files inside JARs can now be opened directly in the editor, letting you read library source code when navigating to a library symbol.
- Added kotlinJump.useGradleTooling to resolve source JARs via ./gradlew instead of scanning the full Gradle cache. Indexes only the project's actual dependencies, producing a smaller and more targeted index at the cost of a slower first run.

### Notes
- Library source indexing is on by default and capped at 50 JARs each for Gradle and Maven caches; adjust the limits with kotlinJump.sourcesJarsMaxCount and kotlinJump.mavenSourcesMaxCount, or override cache paths via kotlinJump.gradleCacheDir and kotlinJump.mavenLocalRepoDir.

## 0.7.7

Adds Move File and Organize Imports commands for Kotlin and Java files.

### Improvements
- Added a Move File command for Kotlin files, accessible from the editor right-click menu. Lets you move or rename a Kotlin file directly from the editor without switching to the file explorer.
- Added an Organize Imports command (Shift+Alt+O) for Kotlin and Java files. Removes unused imports using a heuristic that checks whether the imported name or alias appears in the file body; wildcard imports are always kept. Available from the command palette and the editor right-click menu.
- Added a kotlinJump.organizeImports.removeUnused setting (enabled by default) to opt out of unused-import removal while still running the Organize Imports command.

## 0.7.6

Adds a Move File command for Kotlin files, available from the editor context menu.

### Improvements
- Added a Move File command ("Move File…") for Kotlin files, accessible from the editor right-click menu. Lets you move or rename a Kotlin file directly from the editor without leaving the keyboard.

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
- Java methods, fields, and enum entries are now indexed, making Go to Definition and Find Usages work for individual Java members (not just class declarations) in mixed Kotlin/Java projects.

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
- Added a standalone LSP server so Neovim, Helix, Zed, and other LSP-compatible editors can use Kotlin Jump's navigation (Go to Definition, Find Usages, and Go to Implementation) without VS Code.
- Added companion mode: when the JetBrains Kotlin LSP is detected in the workspace, Kotlin Jump automatically disables its overlapping providers so the two extensions coexist without producing duplicate results.
- Upgraded the rename provider to update import statements across files and rename the file itself when renaming a top-level declaration, making symbol renames more complete and less error-prone.
- Added Kotlin Multiplatform source set detection so module display names in Find Usages results correctly reflect KMP source sets (e.g., commonMain, androidMain) rather than showing generic module paths.

### Fixes
- Capped Find Usages results at 500 per inner search loop, preventing runaway queries from stalling the editor in very large workspaces.

## 0.6.0

Adds a tree-sitter WASM parser for more accurate Kotlin navigation, Go to Composable Preview for Jetpack Compose, and expanded settings for tuning indexing behavior. Plus a fix for member symbol disambiguation in Go to Definition and Find Usages.

### Improvements
- Integrated a tree-sitter WASM Kotlin parser that resolves symbols more accurately across complex Kotlin patterns, reducing incorrect or missing results in Go to Definition and Find Usages.
- Added Go to Composable Preview navigation so Jetpack Compose developers can jump directly to @Preview-annotated functions from the command palette.
- Expanded configurable settings to give more control over indexing behavior: file size limits, snapshot caching, reference exclusions, test source set paths, watcher debounce timing, and status bar visibility.

### Fixes
- Fixed member symbol disambiguation so Go to Definition and Find Usages correctly identify the intended symbol when multiple classes define identically-named members or functions.

## 0.5.0

Adds semantic token highlighting and a TextMate syntax grammar for Kotlin, letting compatible themes color Kotlin-specific constructs like Composable functions, extension functions, and sealed classes.

### Improvements
- Added semantic token highlighting so compatible VS Code themes can apply distinct colors to Kotlin-specific constructs. Including Composable functions, extension functions, sealed classes, and inline, infix, operator, and override members. Giving Kotlin code more accurate, expressive coloring than generic token types allow.
- Added a TextMate grammar for Kotlin, providing consistent baseline syntax highlighting across all themes even without semantic token support.
- Added Kotlin language configuration, enabling standard editor behaviors such as bracket matching, comment toggling, and auto-closing pairs in Kotlin files.

## 0.4.0

Adds native Call Hierarchy and Type Hierarchy navigation, and fixes Find Usages false positives from comments, strings, and generated files.

### Improvements
- Added Call Hierarchy support. Navigate incoming calls (who calls a function) and outgoing calls (what a function calls) using VS Code's native Call Hierarchy panel, with no language server required.
- Added Type Hierarchy support. Explore class supertypes and subtypes with enriched detail in VS Code's native Type Hierarchy panel; also fixes parsing of single-letter supertype names so short class names resolve correctly.

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

Internal quality release adding Compose and ViewModel parser test coverage, a minor KotlinParser fix, and CI upgrades. No changes to extension behavior.

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
- Reworked import resolution logic in ImportResolver. Largest change in this release
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
- **Go to Definition** (Cmd+Click / F12). FQN import resolution, typealias follow-through, test path isolation
- **Go to Implementation** (Cmd+F12). Interface → implementing classes, interface method → overrides
- **Find Usages** (Alt+F7). Custom panel with test/preview toggle filters, direct navigation on single result
- **Find All References** (Shift+F12). Configurable exclusion patterns via `excludeFromReferences`
- **Go to Test** (Alt+Shift+T). Toggle between class and test file by naming convention
- **Smart declaration navigation**. Cmd+Click on declaration: interface → implementations, method → overrides, no override → usages

### Editor features
- **Hover**. Full signature, KDoc, package, module, sealed class subtypes, enum entries
- **Document Outline** (Cmd+Shift+O). Symbol hierarchy with visibility markers
- **Workspace Symbol Search** (Cmd+T). Fuzzy matching with kind filters (`@class:`, `@fun:`, `@compose:`)
- **Copy FQN**. Right-click context menu command

### Performance
- Regex-based parsing on 4 worker threads. No language server
- Persistent snapshot. Restores index on restart, re-parses only changed files
- All lookups < 1ms from 4 O(1) maps (byName, byFqn, byFile, bySuper)

### Supported languages
- Kotlin (`.kt`, `.kts`)
- Java (`.java`). Classes, interfaces, enums, records
