# 🚀 Kotlin Jump

<p align="center">
  <img src="media/logo-128.png" width="96" />
</p>

<p align="center">
  <strong>Instant Kotlin & Java navigation for VS Code</strong><br/>
  No language server. No delay. Just speed.
</p>

<p align="center">
  ⚡ <b>&lt; 1 ms lookups</b> • ⚡ <b>3,000+ files in &lt;500ms</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump">
    <img src="https://img.shields.io/badge/Install-VS_Code-blue?style=for-the-badge&logo=visualstudiocode" />
  </a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/media/Demo.gif" alt="Kotlin Jump demo" width="720" />
</p>

## ⚡ Why Kotlin Jump?

Most navigation tools are:

* slow
* heavy
* tied to language servers

**Kotlin Jump is different.**

👉 No LSP
👉 No JVM
👉 No waiting

Just **instant navigation**.

---

## 🚀 Features

### 🔎 Core Navigation

| Shortcut            | Action                                                |
| ------------------- | ----------------------------------------------------- |
| `Cmd+Click` / `F12` | **Go to Definition** — jump to any symbol instantly   |
| `Cmd+F12`           | **Go to Implementation** — interface → implementation |
| `Shift+F12`         | **Find All References** — across entire project       |
| `Alt+F7`            | **Find Usages** — filtered panel with preview toggles |

---

### ⚡ Smart Navigation (🔥 standout feature)

Cmd+Click adapts intelligently:

| You're on...          | It does...              |
| --------------------- | ----------------------- |
| Interface             | Jumps to implementation |
| Interface method      | Jumps to override       |
| Method (single usage) | Jumps directly to usage |

👉 No extra steps. Just flow.

---

### 🎯 Developer Productivity

| Shortcut      | Feature                                                     |
| ------------- | ----------------------------------------------------------- |
| `Cmd+T`       | **Workspace Search** — fuzzy + filters (`@class:`, `@fun:`) |
| `Cmd+Shift+O` | **Outline** — symbol hierarchy                              |
| `Alt+Shift+T` | **Go to Test** — toggle `Foo.kt` ↔ `FooTest.kt`             |
| Hover         | **Hover Info** — signature, KDoc, package, types            |

---

## 🧠 What gets indexed

### Kotlin

* class, data class, sealed class, interface, object
* enum, fun, @Composable fun
* val, var, typealias

### Java

* class, interface, enum, record, @interface

---

## ⚙️ Configuration

Search **“Kotlin Jump”** in Settings (`Cmd+,`) or use:

```jsonc
{
  "kotlinJump.excludeFromReferences": ["**/src/test*/**", "**/src/debug/**/*Preview.kt"],
  "kotlinJump.testSourceSets": ["/src/test/", "/src/androidTest/"],
  "kotlinJump.smartNavigation": true,
  "kotlinJump.excludePatterns": ["**/build/**", "**/.gradle/**", "**/generated/**"],
  "kotlinJump.maxIndexedFiles": 10000,
  "kotlinJump.concurrency": 20,
  "kotlinJump.parserWorkers": 4
}
```

---

## ⚡ Performance

* ⚡ <1 ms lookup time
* ⚡ <500 ms indexing (3,000+ files)
* ⚡ O(1) symbol resolution

> No language server. No compiler. Just speed.

---

## 🛠 How it works

A lightweight regex-based parser builds an in-memory symbol table using optimized maps.

* 4 worker threads
* incremental indexing
* disk persistence

👉 Only changed files are re-parsed.

---

## ⚠️ Limitations

* ❌ No code completion (not an LSP)
* ❌ No refactoring
* ⚠️ Overloaded functions → selection list
* ⚠️ Extension functions → indexed by name only

---

## 📦 Install

### Marketplace

Search **“Kotlin Jump”** in VS Code (`Cmd+Shift+X`)

---

### VSIX

Download the latest `.vsix` from [GitHub Releases](https://github.com/elumine-dev/kotlin-jump/releases/latest), then run:

```bash
code --install-extension kotlin-jump-0.7.1.vsix
```

---

### Build from source

```bash
git clone https://github.com/elumine-dev/kotlin-jump
cd kotlin-jump && npm install
node esbuild.js --production && npx @vscode/vsce package --no-dependencies
code --install-extension kotlin-jump-0.7.1.vsix
```

---

## 🔗 Links

* [Changelog](CHANGELOG.md)
* [Marketplace](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)
* [Releases](https://github.com/elumine-dev/kotlin-jump/releases)
* [Issues](https://github.com/elumine-dev/kotlin-jump/issues)
