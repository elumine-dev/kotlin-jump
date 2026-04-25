# Kotlin Jump

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/welcome.webp" width="720" alt="Kotlin Jump demo" />
</p>

<p align="center">
  <strong>The Android Studio experience inside VS Code.</strong><br/>
  Fast Kotlin & Android navigation — Find Usages, Go to Definition, Compose, R.string, Android Run.<br/>
  No JVM. No language server.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump"><img src="https://img.shields.io/visual-studio-marketplace/i/elumine.kotlin-jump?label=installs&color=7F52FF&style=flat-square" alt="VS Code installs" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details"><img src="https://img.shields.io/visual-studio-marketplace/r/elumine.kotlin-jump?label=rating&color=7F52FF&style=flat-square" alt="Rating" /></a>
  <a href="https://open-vsx.org/extension/elumine/kotlin-jump"><img src="https://img.shields.io/open-vsx/dt/elumine/kotlin-jump?label=Open%20VSX&color=c160c0&style=flat-square" alt="Open VSX downloads" /></a>
  <a href="https://github.com/elumine-dev/kotlin-jump/blob/main/LICENSE"><img src="https://img.shields.io/github/license/elumine-dev/kotlin-jump?style=flat-square&color=blue" alt="MIT License" /></a>
</p>

<p align="center">
  ⚡ <b>&lt; 1 ms lookups</b> &nbsp;•&nbsp; ⚡ <b>3,000+ files in &lt; 500 ms</b> &nbsp;•&nbsp; ⚡ <b>109× faster than JVM parsers</b>
</p>

<p align="center">
  <b>Click → Jump → Done.</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump">
    <img src="https://img.shields.io/badge/Install-VS_Code-blue?style=for-the-badge&logo=visualstudiocode" alt="Install Kotlin Jump" />
  </a>
</p>

---

## ⚡ Why this feels different

Most Kotlin tooling in VS Code relies on a language server.

That means:

- JVM startup
- background indexing
- delays before things feel "ready"

Kotlin Jump skips all of that.

- No LSP
- No JVM
- No waiting

Just instant navigation across your project.

Once you get used to it, everything else feels slow.

---

## ✨ What's new

- **🎨 Drawable previews** _(v1.17)_ — hover any `R.drawable.*` for an inline thumbnail; the gutter shows a mini render alongside every reference.
- **⚡ Dispatcher-aware suspend markers** _(v1.16)_ — `withContext(Dispatchers.IO)` shows 🧵 inline; thread context at a glance, before the UI freezes.
- **⌨️ Default keyboard shortcuts** _(v1.16)_ — `Alt+F7`, `Alt+Shift+T`, `Cmd+Alt+←/→`, `Shift+Alt+O`. IntelliJ-like out of the box.

[Full changelog →](CHANGELOG.md)

---

## 🏁 Get Started

Open the walkthrough:

**Cmd+Shift+P → Kotlin Jump: Get Started**

Takes ~2 minutes. Worth it.

---

# ✨ Features

---

## 🔎 Core Navigation

Jump anywhere instantly.

| Shortcut | Action |
|---|---|
| `Cmd+Click` / `F12` | Go to Definition |
| `Cmd+F12` | Go to Implementation |
| `Shift+F12` | Find All References |
| `Alt+F7` | Find Usages |

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/go-to-definition.webp" width="720" />
</p>

Works across:

- Kotlin & Java
- interfaces → implementations
- functions, classes, enums
- imports
- **library source JARs** (Compose, Coroutines, AndroidX…)

> **Call Hierarchy** and **Type Hierarchy** are also available via VS Code's native panels (right-click → Peek).

---

## ⚡ Smart Navigation

`Cmd+Click` adapts automatically.

| You click on | It goes to |
|---|---|
| Interface | Implementation |
| Interface method | Override |
| Method (1 usage) | That usage |

No menus. No thinking.

---

## 🎯 Find Usages

Fast, focused, built for real projects.

- grouped by file
- inline previews
- toggle tests on/off
- toggle `@Preview`
- optimized for large codebases

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/find-usages-test-filter.webp" width="720" />
</p>

---

## 📱 Android Run Button

Build, install, launch — one click.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/android-run.webp" width="720" />
</p>

No setup required. Detects your app module automatically, picks the right Gradle install task, and launches on the connected device or emulator.

No device connected? It finds your AVDs and offers to start one.

**Monorepos and multi-flavor projects** — add `kotlinJump.androidProjects` to `.vscode/settings.json`.

Also needed if your `applicationId` lives in a **build-logic convention plugin** — the auto-detector can't read it.

```jsonc
// .vscode/settings.json
{
  "kotlinJump.androidProjects": [
    {
      "name": "Mobile",
      "module": "mobile/app",
      "package": "com.example.mobile.debug",
      "variant": "Debug"
    },
    {
      "name": "TV",
      "module": "tv/app",
      "package": "com.example.tv.debug",
      "variant": "TvDebug"
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Label shown in button and picker |
| `module` | Path to app module — `"app"` or `"mobile/app"` |
| `package` | Debug application ID |
| `variant` | Build variant → `install{Variant}` (default: `"Debug"`) |

A `$(chevron-down)` button appears next to Run when multiple apps are configured. Click to switch.

Reset: **Cmd+Shift+P → Kotlin Jump: Reset Android Run Config**

> 💡 **Saving time on every Cmd+R?** Help other Android devs find Kotlin Jump → [**⭐ Rate it on the Marketplace**](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details). 30 seconds, real impact.

---

## 🧵 String Resource Folding

Stop jumping to `strings.xml`.

```kotlin
Text(text = R.string.button_ok)

// becomes

Text(text = "OK")
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/string-resource-folding.webp" width="720" />
</p>

Android only.

### 🌍 Locale grid on hover

Hover any `R.string.*` reference to see **every translation side by side** — no hunt through `values-*/strings.xml`.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/string-locale-grid.webp" width="720" />
</p>

---

## 🔢 Code Lens

Always-visible context.

- **N usages** — click to open Find Usages
- **M implementations** — click to list all implementors
- **▶ Run** / **⏱ Debug** above `@Test` methods — Gradle-backed, wired into Test Explorer

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/code-lens.webp" width="720" />
</p>

No hover. No guessing.

---

## 🧪 Developer Productivity

Removes the tiny frictions you hit all day.

| Shortcut | Feature |
|---|---|
| `Cmd+T` | Workspace Search (`@class:`, `@fun:`…) |
| `Cmd+Shift+O` | File Outline |
| `Alt+Shift+T` | Go to Test |
| `Alt+Shift+P` | Composable ↔ Preview |
| `Shift+Alt+O` | Organize Imports |
| Hover | Signature, KDoc, types |
| Right-click | Move File, Copy FQN |

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/test-nav.webp" width="720" />
</p>

---

## 🧭 Navigation History

Back and forward — with **line AND column restored**, not just the file.

| Shortcut | Action |
|---|---|
| `Cmd+Alt+←` | Navigate Back |
| `Cmd+Alt+→` | Navigate Forward |

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/navigation-history.webp" width="720" />
</p>

Every stop remembered exactly where you were — across files, across packages.

---

## 📝 Inlay Hints

See what matters, inline.

- **Parameter names** at call sites — clickable to navigate to the declaration
- **Inferred types** on `val` / `var` — double-click to insert

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/inlay-hints.webp" width="720" />
</p>

---

## 🦺 Kotlin Quality of Life

Signals you didn't know you needed — right where the code lives.

### ⚡ Suspend Call Markers

Every `suspend` call is a potential pause. Every dispatcher switch is a potential thread hop. Kotlin Jump marks both — inline, live.

- **⚡** — every suspend call in a coroutine body
- **🧵 IO** · **🖥 Main** · **⚙ Default** — dispatcher badges on `withContext` and launchers

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/suspend-call-marker.webp" width="720" />
</p>

Know your pauses. Know your threads. Before the UI freezes.

### 🎨 R.drawable — Hover preview + gutter thumbnails

Every `R.drawable.*` reference paints a miniature of the asset in the gutter. Hover the name to pop a 128 × 128 SVG preview, the file path, and every density / -night / -v24 variant — no more Cmd+Click-and-squint to remember which icon is which.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/drawable-hover.webp" width="720" />
</p>

---

## 📦 Library Sources

Go to Definition works inside your dependencies too — out of the box.

Kotlin Jump indexes sources from **four locations** and surfaces a single **`$(library)` status bar item** showing the state at a glance:

| Source | When |
|---|---|
| **Bundled Kotlin stdlib** (~600 KB shipped with the extension) | Always — `List`, `String`, `Sequence`, etc. work from the first second, even with a cold cache and offline |
| **JDK `lib/src.zip`** | Auto-detected via `JAVA_HOME` (macOS `/usr/libexec/java_home`, Linux `update-alternatives`, Windows scan) — `java.lang.*`, `java.util.*` |
| **Gradle cache** (`~/.gradle/caches/modules-2/files-2.1`) | Existing `-sources.jar` files, all configurations |
| **Maven local repo** (`~/.m2/repository`) | Existing `-sources.jar` files |

When library sources are missing from the local caches, click the status bar item → **"Download missing sources"**. Kotlin Jump fetches them via direct HTTP from Maven Central — **no JVM, no Gradle invocation, no terminal**. Downloaded JARs land in the standard Gradle cache layout, so they integrate seamlessly with your other tools.

```
$(library) KJ: 42 libs · JDK · stdlib ✓
```

Click the item for a menu of actions: download missing sources, refresh cache, open settings, view documentation.

No language server. No background process. No JVM running in the extension.

### Cmd+Click straight into `kotlinx.coroutines`

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/lib-jar-coroutines.webp" width="720" />
</p>

### KDoc on hover — from the JAR

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/lib-jar-kdoc-hover.webp" width="720" />
</p>

No docs site. No language server. KDoc extracted directly from the matching `-sources.jar`.

---

## 🤖 AI Assistant

Query your codebase in natural language.

```
@kotlin-jump find all implementations of Repository
@kotlin-jump doc for BattleEngine
@kotlin-jump usages of loadData
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/demos/ai-assistant.webp" width="720" />
</p>

**MCP Server** — Kotlin Jump also exposes a Model Context Protocol endpoint. External tools that support MCP (Claude Desktop, etc.) can query the symbol index directly without VS Code open.

No setup. Works immediately.

---

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump">
    <img src="https://img.shields.io/badge/Install_now-Try_it_yourself-blue?style=for-the-badge&logo=visualstudiocode" />
  </a>
</p>

---

## 🧠 What it understands

Kotlin Jump builds a full symbol map of your project.

### Kotlin

- class, data class, sealed class, interface, object
- enum, fun, `@Composable`
- val, var, typealias

### Java

- class, interface, enum, record, `@interface`

---

## 🤝 Companion Mode

Already using the **JetBrains Kotlin LSP**? Kotlin Jump detects it automatically and disables overlapping providers (hover, outline, rename, semantic tokens) — keeping only its fast navigation layer.

Set `kotlinJump.companionMode` to `"auto"` (default), `"always"`, or `"never"`.

---

## ⚙️ Configuration

Search **Kotlin Jump** in VS Code settings (`Cmd+,`).

```jsonc
{
  // Navigation
  "kotlinJump.smartNavigation": true,
  "kotlinJump.companionMode": "auto",
  "kotlinJump.excludePatterns": ["**/build/**", "**/.gradle/**", "**/generated/**"],
  "kotlinJump.excludeFromReferences": ["**/src/test*/**"],
  "kotlinJump.maxIndexedFiles": 10000,
  "kotlinJump.indexSourcesJars": true,
  "kotlinJump.snapshotEnabled": true,

  // Android Run button
  "kotlinJump.androidRunEnabled": true,
  "kotlinJump.androidProjects": [],  // see Android Run section above
  "kotlinJump.androidVariant": "Debug",  // fallback when task discovery finds nothing
  "kotlinJump.androidSkipLaunch": false  // set to true to build-only (skip adb launch)
}
```

---

## ⚡ Performance

- < 1 ms lookup
- < 500 ms indexing (3k+ files)
- incremental updates (changed files only)
- ~50 ms restart restore

No compiler. No background engine.

---

## 🛠 How it works

- regex-based parser — 109× faster than tree-sitter WASM
- worker thread pool
- incremental indexing
- disk snapshot

Fast by design.

---

## ⚠️ Limitations

- No code completion (not an LSP)
- No full refactoring
- Overloaded functions → selection list
- Extension functions → indexed by name only
- String folding → Android only

Kotlin Jump focuses on one thing: **navigation speed**.

---

## ⭐ Like Kotlin Jump?

If it shaved minutes off your day, **even 30 seconds of your time would mean a lot** — every rating helps other Android & Kotlin devs find this.

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details">
    <img src="https://img.shields.io/badge/⭐_Rate_on_Marketplace-7F52FF?style=for-the-badge" alt="Rate Kotlin Jump on the VS Code Marketplace" />
  </a>
</p>

Found a bug or have a feature idea? [**Open an issue**](https://github.com/elumine-dev/kotlin-jump/issues) — answers usually within 24 h.

---

## 🔽 Install

### Marketplace

Search **Kotlin Jump** in VS Code (`Cmd+Shift+X`) or install directly:

[marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)

---

### VSIX

Download the latest `.vsix` from [GitHub Releases](https://github.com/elumine-dev/kotlin-jump/releases/latest), then:

```bash
code --install-extension kotlin-jump-1.17.1.vsix
```

---

### Build from source

```bash
git clone https://github.com/elumine-dev/kotlin-jump
cd kotlin-jump && npm install
node esbuild.js --production && npx @vscode/vsce package --no-dependencies
code --install-extension kotlin-jump-1.17.1.vsix
```

---

## 🔗 Links

- [Changelog](CHANGELOG.md)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)
- [Releases](https://github.com/elumine-dev/kotlin-jump/releases)
- [Issues](https://github.com/elumine-dev/kotlin-jump/issues)
