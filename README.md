# Kotlin Nav

Fast Kotlin & Java navigation for VS Code — no language server, no delay.

All lookups resolve in **under 1 ms**. Indexes 3,000+ files in under 500ms.

<!-- TODO: Replace with actual GIF -->
<!-- ![Kotlin Nav demo](media/demo.gif) -->

---

## Features

| Shortcut | Action |
|---|---|
| `Cmd+Click` / `F12` | **Go to Definition** — jump to any class, function, property, interface |
| `Cmd+F12` | **Go to Implementation** — interface → implementing class, method → override |
| `Alt+F7` | **Find Usages** — custom panel with test/preview filter toggles |
| `Shift+F12` | **Find All References** — every usage across the whole project |
| `Alt+Shift+T` | **Go to Test** — toggle between `Foo.kt` ↔ `FooTest.kt` |
| `Cmd+T` | **Workspace Search** — fuzzy matching + kind filters (`@class:`, `@fun:`, `@compose:`) |
| `Cmd+Shift+O` | **Outline** — symbol hierarchy with visibility markers |
| Hover | **Hover** — signature, KDoc, package, module, sealed subtypes, enum entries |

### Smart Cmd+Click

Cmd+Click at a declaration does the smart thing:

| You're on... | Cmd+Click does... |
|---|---|
| An interface | Jumps to the implementing class |
| An interface method | Jumps to the override |
| A method with no override | Navigates directly to the single usage |

### What gets indexed

**Kotlin** — class, data class, sealed class, interface, object, enum, fun, @Composable fun, val, var, typealias

**Java** — class, interface, enum, record, @interface

---

## Configuration

Search `Kotlin Nav` in Settings (`Cmd+,`), or add to `settings.json`:

```jsonc
{
  // Exclude from Find All References (files are still indexed for Go to Definition)
  "kotlinNav.excludeFromReferences": ["**/src/test*/**", "**/src/debug/**/*Preview.kt"],

  // Test paths — Go to Definition skips these when navigating from main source
  "kotlinNav.testSourceSets": ["/src/test/", "/src/androidTest/"],

  // false = use VS Code built-in References instead of custom Find Usages panel
  "kotlinNav.smartNavigation": true,

  // Exclude from indexing entirely
  "kotlinNav.excludePatterns": ["**/build/**", "**/.gradle/**", "**/generated/**"],

  // Performance tuning
  "kotlinNav.maxIndexedFiles": 10000,
  "kotlinNav.concurrency": 20,
  "kotlinNav.parserWorkers": 4
}
```

---

## Install

**From Marketplace:** Search "Kotlin Nav" in VS Code Extensions (`Cmd+Shift+X`)

**From VSIX:**
```bash
code --install-extension kotlin-nav-0.1.0.vsix
```

**Build from source:**
```bash
git clone https://github.com/KevinDoremy/kotlin-nav
cd kotlin-nav && npm install
node esbuild.js --production && vsce package --no-dependencies
code --install-extension kotlin-nav-0.1.0.vsix
```

---

## How it works

Regex-based parser on 4 worker threads builds an in-memory symbol table with 4 O(1) maps. Index persists to disk — restarts only re-parse changed files.

No language server. No compiler. No JVM. Just fast lookups.

---

## Known limitations

- **No code completion** — this is a navigation extension, not an LSP
- **No refactoring** — use the Kotlin Language Server extension alongside this for rename/extract
- **Overloaded functions** — same-name functions show a peek list for you to choose
- **Extension functions** — receiver types not tracked, indexed by function name only

---

## Links

- [Full Guide](doc/full-guide.md) — detailed docs for every feature, shortcut, and configuration
- [Changelog](CHANGELOG.md)
- [GitHub Issues](https://github.com/KevinDoremy/kotlin-nav/issues)
- [elumine.ca](https://elumine.ca)

*Managed by [elumine.ca](https://elumine.ca)*
