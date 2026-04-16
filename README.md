# 🚀 Kotlin Jump

<p align="center">
  <img src="media/logo-128.png" width="96" alt="Kotlin Jump logo" />
</p>

<p align="center">
  <strong>Kotlin navigation in VS Code that actually feels instant.</strong><br/>
  No LSP. No JVM. No delay.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/welcome.gif" width="720" alt="Kotlin Jump demo" />
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
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/go-to-definition.gif" width="720" />
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
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/find-usages.gif" width="720" />
</p>

---

## 🔢 Code Lens

Always-visible context.

- **N usages** — click to open Find Usages
- **M implementations** — click to list all implementors
- **▶ Run** / **⏱ Debug** above `@Test` methods — Gradle-backed, wired into Test Explorer

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/code-lens.gif" width="720" />
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
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/test-nav.gif" width="720" />
</p>

---

## 📱 Android Run Button

Build, install, launch — one click.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/android-run.gif" width="720" />
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

---

## 🧵 String Resource Folding

Stop jumping to `strings.xml`.

```kotlin
Text(text = R.string.button_ok)

// becomes

Text(text = "OK")
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/string-folding.gif" width="720" />
</p>

Android only.

---

## 📝 Inlay Hints

See what matters, inline.

- **Parameter names** at call sites — clickable to navigate to the declaration
- **Inferred types** on `val` / `var` — double-click to insert

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/inlay-hints.gif" width="720" />
</p>

---

## 📦 Library Sources

Go to Definition works inside your dependencies too.

Kotlin Jump indexes `-sources.jar` files from your Gradle cache (`~/.gradle`) and Maven local repo (`~/.m2`). Enables **Go to Definition** and **KDoc** for any library that ships sources — Compose, Coroutines, AndroidX, and more.

No extra setup. Runs automatically in the background.

---

## 🤖 AI Assistant

Query your codebase in natural language.

```
@kotlin-jump find all implementations of Repository
@kotlin-jump doc for BattleEngine
@kotlin-jump usages of loadData
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/walkthrough/ai-assistant.gif" width="720" />
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

## 🔽 Install

### Marketplace

Search **Kotlin Jump** in VS Code (`Cmd+Shift+X`) or install directly:

[marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)

---

### VSIX

Download the latest `.vsix` from [GitHub Releases](https://github.com/elumine-dev/kotlin-jump/releases/latest), then:

```bash
code --install-extension kotlin-jump-1.7.0.vsix
```

---

### Build from source

```bash
git clone https://github.com/elumine-dev/kotlin-jump
cd kotlin-jump && npm install
node esbuild.js --production && npx @vscode/vsce package --no-dependencies
code --install-extension kotlin-jump-1.7.0.vsix
```

---

## 🔗 Links

- [Changelog](CHANGELOG.md)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)
- [Releases](https://github.com/elumine-dev/kotlin-jump/releases)
- [Issues](https://github.com/elumine-dev/kotlin-jump/issues)
