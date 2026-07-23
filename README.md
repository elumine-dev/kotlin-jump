# Kotlin Jump

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/welcome.webp" width="720" alt="Kotlin Jump demo" />
</p>

<p align="center">
  <strong>The Android Studio experience for Kotlin & Java in VS Code.</strong><br/>
  Fast navigation. Deep refactor. Full Android workflow.<br/>
  No JVM. No language server.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump"><img src="https://vsmarketplacebadges.dev/installs-short/elumine.kotlin-jump.png" alt="VS Code installs" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details"><img src="https://vsmarketplacebadges.dev/rating-short/elumine.kotlin-jump.png" alt="Rating" /></a>
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
    <img src="https://img.shields.io/badge/Install-VS_Code-blue?style=for-the-badge&logo=visualstudiocode" alt="Install for VS Code" />
  </a>
  &nbsp;
  <a href="https://open-vsx.org/extension/elumine/kotlin-jump">
    <img src="https://img.shields.io/badge/Install-Open_VSX-c160c0?style=for-the-badge" alt="Install for Cursor, VSCodium, Windsurf, and other VS Code forks" />
  </a>
</p>

<p align="center">
  <sub>Open VSX serves <strong>Cursor</strong>, <strong>VSCodium</strong>, <strong>Windsurf</strong>, <strong>Gitpod</strong>, and most other VS Code forks.</sub>
</p>

---

## Why this feels different

Other Kotlin extensions wait. JVM startup, background indexing, "loading…" before you can click anything.

Kotlin Jump skips all of that. **No LSP. No JVM. No waiting.**

**Once you get used to it, everything else feels slow.**

---

## ✨ Recent

- **🎨 Vector drawable preview.** Open a `<vector>` XML and a side by side render appears automatically. Hover `R.drawable.*` for an inline thumbnail. Gutter mini next to every reference.
- **🧵 Coroutine thread badges.** `🧵 IO` · `🖥 Main` next to every dispatched call.
- **⌨️ IntelliJ keymap bundled.** `Alt+F7`, `Alt+Shift+T`, `Cmd+Alt+←/→` work the moment you install.

[Full changelog →](CHANGELOG.md)

---

## Features

---

## Core Navigation

Jump anywhere instantly.

| Shortcut | Action |
|---|---|
| `Cmd+Click` / `F12` | Go to Definition |
| `Cmd+F12` | Go to Implementation |
| `Shift+F12` | Find All References |
| `Alt+F7` | Find Usages |

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/go-to-definition.webp" width="720" />
</p>

Kotlin, Java, Compose, AndroidX. Same speed across your project and your dependency JARs.

---

## Smart Navigation

`Cmd+Click` adapts automatically.

| You click on | It goes to |
|---|---|
| Interface | Implementation |
| Interface method | Override |
| Method (1 usage) | That usage |

No menus. No thinking.

---

## Find Usages

Alt+F7. Every usage, grouped by file, with previews.

- grouped by file
- inline previews
- toggle tests on/off
- toggle `@Preview`
- optimized for large codebases

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/find-usages-test-filter.webp" width="720" />
</p>

---

## 📱 Android Run Button

Build, install, launch. One click.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/android-run.webp" width="720" />
</p>

No setup. Detects your app module, picks the right Gradle install task, launches on the connected device or emulator.

No device connected? Finds your AVDs and offers to start one.

Working in a monorepo or with several product flavors? See [Android setup →](ANDROID-SETUP.md).

> 💡 **Saving time on every Cmd+R?** Help other Android devs find Kotlin Jump → rate it on [**⭐ Marketplace**](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details) or [**⭐ Open VSX**](https://open-vsx.org/extension/elumine/kotlin-jump). 30 seconds, real impact.

---

## 🧵 String Resource Folding

Stop jumping to `strings.xml`.

```kotlin
Text(text = R.string.button_ok)

// becomes

Text(text = "OK")
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/string-resource-folding.webp" width="720" />
</p>

Android only.

### 🌍 Locale grid on hover

Hover any `R.string.*` reference to see **every translation side by side**. No hunt through `values-*/strings.xml`.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/string-locale-grid.webp" width="720" />
</p>

---

## Code Lens

Always-visible context.

- **N usages.** Click to open Find Usages.
- **M implementations.** Click to list all implementors.
- **▶ Run** / **⏱ Debug** above `@Test` methods. Gradle-backed, wired into Test Explorer.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/code-lens.webp" width="720" />
</p>

No hover. No guessing.

---

## Developer Productivity

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
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/test-nav.webp" width="720" />
</p>

---

## Navigation History

Back and forward, with **line and column restored**, not just the file.

| Shortcut | Action |
|---|---|
| `Cmd+Alt+←` | Navigate Back |
| `Cmd+Alt+→` | Navigate Forward |

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/navigation-history.webp" width="720" />
</p>

The way IntelliJ does it. Without IntelliJ.

---

## Inlay Hints

See what matters, inline.

- **Parameter names** at call sites. Clickable to navigate to the declaration.
- **Inferred types** on `val` / `var`. Double-click to insert.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/inlay-hints.webp" width="720" />
</p>

---

## Kotlin Quality of Life

Signals you didn't know you needed, right where the code lives.

### ⚡ Suspend Call Markers

Every `suspend` call is a potential pause. Every dispatcher switch is a potential thread hop. Kotlin Jump marks both, inline and live.

- **⚡** on every suspend call in a coroutine body.
- **🧵 IO** · **🖥 Main** · **⚙ Default** dispatcher badges on `withContext` and launchers.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/suspend-call-marker.webp" width="720" />
</p>

Know your pauses. Know your threads. Before the UI freezes.

### ⏰ Overdue TODO Highlight

Date your TODOs and they hold you to it.

```kotlin
// TODO(2025-01-01): migrate to Room   ← red, that ship has sailed
// TODO(2027-06-01): optimize later    ← quiet until the day comes
```

Once the date passes, the TODO turns red. No config, no ceremony. Turn it off with `kotlinJump.todoExpiry` if you prefer your debt silent.

### 🔐 Permission hover

Hover any Android permission and know what you're asking for.

```kotlin
Manifest.permission.ACCESS_FINE_LOCATION
// → dangerous · requires a runtime request
// → "Allows the app to get the precise location of the device."
```

Works on `Manifest.permission.*` constants and on `"android.permission.*"` strings, including inside `AndroidManifest.xml`. Covers 61 permissions, with migration notes on the legacy ones (`WRITE_EXTERNAL_STORAGE`, `BLUETOOTH`, `USE_FINGERPRINT`).

### ♿ Compose accessibility nudges

Two TalkBack traps, caught while you type.

```kotlin
Image(painter = p, contentDescription = null)  ⚠ a11y: decorative?
Box(Modifier.clickable { open() })             ⚠ a11y: role?
```

Hints, not errors: `null` is right for decorative images, so the hint asks instead of asserting. Hover it for the fix. Toggle with `kotlinJump.composeAccessibilityHints`.

### 🔢 Flow chain step badges

Long pipelines, numbered stages.

```kotlin
flow
    ① .map { it.name }
    ② .filter { it.isNotEmpty() }
    ③ .collect { render(it) }
```

Multi line Flow and collection chains get ① ② ③ badges, so you can talk about "step 2" instead of counting dots. Single operators stay clean. Toggle with `kotlinJump.flowChainBadges`.

### 🚫 Deprecation, visible

Deprecated symbols get native strikethrough, at the declaration and at every resolved call site. Hover shows why and what to use instead:

```kotlin
@Deprecated("Use fetchV2", ReplaceWith("fetchV2(id)"))
fun fetch(id: Int)

fetch(7)   // struck through · hover → "Use fetchV2" + the replacement snippet
```

Multi line `@Deprecated(...)` annotations included. When two same name symbols could match, the hover stays quiet rather than flagging the wrong one.

### 🎨 Vector drawable preview

Open any `<vector>` XML drawable and a rendered preview appears side by side automatically. Hover any `R.drawable.*` reference for an inline thumbnail. The gutter shows a mini render next to every reference. Click the CodeLens above the XML file to open the dedicated preview panel.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/vector-preview.webp" width="720" />
</p>

---

## 📦 Library Sources

Go to Definition works inside your dependencies too. Out of the box.

Kotlin stdlib ships bundled (~600 KB). Compose, Coroutines, AndroidX and other JARs are indexed from your Gradle/Maven cache automatically, or downloaded directly from Maven Central in one click.

```
$(library) KJ: 42 libs · JDK · stdlib ✓
```

**No language server. No background process. No JVM.**

### Cmd+Click straight into `kotlinx.coroutines`

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/lib-jar-coroutines.webp" width="720" />
</p>

### KDoc on hover, straight from the JAR

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/lib-jar-kdoc-hover.webp" width="720" />
</p>

KDoc extracted directly from the matching `-sources.jar`.

---

## 🤖 AI Assistant

Query your codebase in natural language.

```
@kotlin-jump find all implementations of Repository
@kotlin-jump doc for BattleEngine
@kotlin-jump usages of loadData
```

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/ai-assistant.webp" width="720" />
</p>

Also exposes an **MCP endpoint** for Claude Desktop and other AI tools, so you can query the index without VS Code open.

No setup. Works immediately.

---

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump">
    <img src="https://img.shields.io/badge/Install_now-Try_it_yourself-blue?style=for-the-badge&logo=visualstudiocode" />
  </a>
</p>

---

## 🧠 What it understands

Every Kotlin construct: classes, data/sealed classes, objects, enums, functions, properties, typealiases, `@Composable`. Every Java construct: classes, interfaces, enums, records, annotations.

---

## Companion Mode

Already using the **JetBrains Kotlin LSP**? Kotlin Jump detects it automatically and disables overlapping providers (hover, outline, rename, semantic tokens), keeping only its fast navigation layer.

Auto-detected. Tweak via the `kotlinJump.companionMode` setting if needed.

Pair with [**detekt-lsp**](https://github.com/elumine-dev/detekt-lsp) for live Detekt diagnostics in any LSP editor (pre-alpha).

---

## 🌐 Web support

Kotlin Jump runs on vscode.dev and github.dev: navigation, Find Usages, Code Lens, folding, hover, and the AI chat participant all work with no backend. Android Run, ADB, Logcat, and JAR source scanning need a real machine behind the editor. They work as-is in a GitHub Codespace opened in a browser tab, since VS Code detects the Codespace's Node backend and loads the full desktop feature set automatically. See [`doc/web-support.md`](doc/web-support.md) for the exact breakdown.

---

## Configuration

Search **Kotlin Jump** in VS Code settings (`Cmd+,`). All defaults work out of the box. No tweaks required for 95 % of projects.

One exception: `kotlinJump.testTaskOverrides`. The test runner picks `testDebugUnitTest` for Android modules and plain `test` otherwise, but it can't see an Android plugin applied indirectly through your own convention plugins. Set the task explicitly when that's the case, or when a flavor makes `testDebugUnitTest` ambiguous:

```json
"kotlinJump.testTaskOverrides": {
  ":app": "testDebugUnitTest"
}
```

Multiple project folders in one workspace: this setting reads from each folder's own `.vscode/settings.json`, not the shared `settings` block of a `.code-workspace` file, so two folders with their own `:app` module can each get a different task.

---

## ⭐ Like Kotlin Jump?

If it shaved minutes off your day, **even 30 seconds of your time would mean a lot**. Every rating helps other Android & Kotlin devs find this.

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details">
    <img src="https://img.shields.io/badge/⭐_Rate_on_Marketplace-7F52FF?style=for-the-badge" alt="Rate Kotlin Jump on the VS Code Marketplace" />
  </a>
  &nbsp;
  <a href="https://open-vsx.org/extension/elumine/kotlin-jump">
    <img src="https://img.shields.io/badge/⭐_Rate_on_Open_VSX-c160c0?style=for-the-badge" alt="Rate Kotlin Jump on Open VSX" />
  </a>
</p>

Found a bug or have a feature idea? [**Open an issue**](https://github.com/elumine-dev/kotlin-jump/issues). Answers usually within 24 h.

---

## 🔽 Install

Search **Kotlin Jump** in your editor's Extensions tab (`Cmd+Shift+X`), or install directly from [Marketplace](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump) (VS Code) or [Open VSX](https://open-vsx.org/extension/elumine/kotlin-jump) (Cursor, VSCodium, Windsurf).

### VSIX

For offline installs (machines without internet access), grab the latest `.vsix` from [GitHub Releases](https://github.com/elumine-dev/kotlin-jump/releases/latest):

```bash
code --install-extension kotlin-jump-1.27.0.vsix
```

### Build from source

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev setup, or quickstart:

```bash
code --install-extension kotlin-jump-1.27.0.vsix
```

---

## Companion tools

- **Kotlin Jump** : this extension.
- [**detekt-lsp**](https://github.com/elumine-dev/detekt-lsp) : Live Detekt diagnostics for any LSP editor (pre-alpha).
- [**SearchDeadCode**](https://github.com/KevinDoremy/SearchDeadCode) : Dead code detection for Android (Rust CLI on Homebrew).

Maintained alongside [elumine-dev](https://github.com/elumine-dev) by [Kevin Doremy](https://kevindoremy.com).

---

## 🔗 Links

- [Changelog](CHANGELOG.md)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump)
- [Releases](https://github.com/elumine-dev/kotlin-jump/releases)
- [Issues](https://github.com/elumine-dev/kotlin-jump/issues)
