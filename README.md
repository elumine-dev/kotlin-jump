# 🚀 Kotlin Jump

**Instant Kotlin & Java navigation for VS Code — no language server, no delay.**

⚡ All lookups resolve in **under 1 ms**
⚡ Indexes **3,000+ files in <500ms**

> Stop scrolling. Start jumping.

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

```bash
code --install-extension kotlin-jump-0.1.0.vsix
```

---

### Build from source

```bash
git clone https://github.com/elumine-dev/kotlin-jump
cd kotlin-jump && npm install
node esbuild.js --production && vsce package --no-dependencies
code --install-extension kotlin-jump-0.1.0.vsix
```

---

## 🔗 Links

* 📘 [Full Guide](doc/full-guide.md)
* 🧾 [Changelog](CHANGELOG.md)
* 🐛 [Issues](https://github.com/elumine-dev/kotlin-jump/issues)
* 🌐 [elumine.ca](https://elumine.ca)
