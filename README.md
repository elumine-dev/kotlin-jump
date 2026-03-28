# Kotlin Nav

Instant Go to Definition for Kotlin — no language server, no indexing delay, no overhead.

Works by scanning your `.kt` and `.java` files with regex patterns and building an in-memory symbol table. Cmd+Click resolves in under 1 ms once the index is warm.

---

## Features

| Action | Shortcut | What it does |
|---|---|---|
| **Go to Definition** | `F12` or `Cmd+Click` | Jump to where a class, function, property, or object is declared |
| **Peek Definition** | `Alt+F12` | View the declaration inline without leaving your current file |
| **Find All References** | `Shift+F12` | List every usage of the symbol across the whole project |
| **Go to Symbol in Workspace** | `Cmd+T` | Search all indexed symbols — fuzzy search + kind filter |
| **Go to Symbol in File** | `Cmd+Shift+O` | Navigate symbols in the current file via the Outline panel |
| **Hover** | Hover over any symbol | See the full signature, package, file, module, and KDoc comment |
| **Copy FQN** | Right-click → *Kotlin Nav: Copy FQN* | Copy the fully qualified name to clipboard |
| **Re-index** | `Cmd+Shift+P` → *Kotlin Nav: Re-index workspace* | Force a full re-scan after a large git pull or branch switch |

### What gets indexed

**Kotlin**
- `class`, `data class`, `sealed class`, `abstract class`, `annotation class`
- `interface`, `sealed interface`
- `object`, `companion object`
- `enum class` and enum entries
- `fun` and `@Composable fun`
- `val`, `var`, `const val`, `lateinit var`
- `typealias`

**Java** *(mixed Kotlin/Java projects)*
- `class`, `interface`, `enum`, `record`, `@interface` (annotation type)

---

## How to use

### Cmd+Click (Go to Definition)

Hold `Cmd` (macOS) or `Ctrl` (Windows/Linux) and click any symbol name. VS Code jumps to the file and line where it is declared.

```kotlin
val repo = UserRepository()  // ← Cmd+Click on "UserRepository" → jumps to its declaration
```

Works across Kotlin and Java files in the same project.

### F12

Place the cursor on any symbol and press `F12`. Same result as Cmd+Click.

### Alt+F12 (Peek)

Press `Alt+F12` to see the declaration in an inline peek panel without navigating away.

### Shift+F12 (Find All References)

Place the cursor on any symbol and press `Shift+F12`. VS Code opens the References panel listing every file and line where the symbol is used.

```kotlin
class UserRepository { ... }
//     ↑ Shift+F12 → lists every call site, type annotation, constructor usage, etc.
```

Results include usages in both Kotlin and Java files. The declaration itself is included or excluded based on VS Code's *Include Declaration* setting in the References panel.

### Cmd+T (Go to Symbol in Workspace)

Press `Cmd+T` (or `Ctrl+T`), start typing, and pick from the list.

#### Fuzzy search

The search is fuzzy — characters don't need to be consecutive:

```
KS   → KioskScreen
UC   → UseCase
VM   → ViewModel
```

Prefix matches always rank first, then fuzzy matches sorted by score.

#### Kind filter

Prefix your query with `@tag:` to restrict results to a specific symbol kind:

```
@class:kiosk        → classes/data classes/sealed classes containing "kiosk"
@fun:connect        → functions containing "connect"
@compose:Screen     → @Composable functions containing "Screen"
@enum:              → list every enum in the project (no name needed)
@object:repo        → object singletons containing "repo"
@val:config         → val/const val containing "config"
@type:edition       → all class-like types + typealiases containing "edition"
```

**All supported tags:**

| Tag | Matches |
|---|---|
| `@class` | `class`, `data class`, `sealed class`, `annotation class` |
| `@interface` | `interface` |
| `@object` | `object` singletons |
| `@enum` | `enum class` |
| `@fun` | `fun` + `@Composable fun` |
| `@compose` | `@Composable fun` only |
| `@val` | `val` / `const val` |
| `@var` | `var` |
| `@typealias` | `typealias` |
| `@type` | all class-like types + `typealias` |

The name part is optional — `@enum:` alone lists all enums. An unrecognised tag falls back to normal search, so nothing breaks.

### Cmd+Shift+O (Outline / Go to Symbol in File)

Open any `.kt` file and press `Cmd+Shift+O` to search symbols in that file. The **Outline** panel in the Explorer sidebar shows the full symbol tree with:

- Nested hierarchy (class members indented under their class)
- Visibility shown as detail text: `private`, `protected`, `internal` (public shows nothing)
- Different icons per symbol kind (see icon reference below)

#### Outline icon reference

| Icon | Kind | Used for |
|---|---|---|
| Class (amber) | `Class` | `class`, `sealed class`, `annotation class` |
| Struct | `Struct` | `data class` |
| Interface (blue) | `Interface` | `interface`, `typealias` |
| Object `{ }` | `Object` | `object` singleton |
| Enum (amber) | `Enum` | `enum class` |
| EnumMember (blue) | `EnumMember` | enum entries (`CONNECTED`, `OFFLINE`) |
| Method (purple) | `Method` | member `fun`, `@Composable fun` |
| Function (purple) | `Function` | top-level `fun` |
| Property (wrench) | `Property` | public/internal `val` or `var` member |
| Field (blue box) | `Field` | **private** or **protected** `val` or `var` |
| Constant | `Constant` | top-level `val` |
| Variable | `Variable` | top-level `var` |

> Make sure `"outline.icons": true` is set in your VS Code settings to see the icons.

### Hover

Hover over any symbol to see:

```
data class KioskEdition(
    val uid: EditionUid,
    val type: String,
    // ...
)
─────
*ca.lapresse.android.lapresseplus.mainV2.ui.kiosk.model*
`KioskEdition.kt` — `:feature:kiosk`
─────
Represents a single edition in the kiosk screen.
```

For **sealed classes** and **enums**, the hover also lists all variants/entries:

```
internal sealed class KioskNavigationEvent
─────
*ca.lapresse.android.lapresseplus.mainV2.ui.kiosk*
`KioskNavigationEvent.kt`
─────
Sealed class representing all navigation events in the Kiosk flow.
─────
Subtypes (2)
· NavigateToEdition  data class
· NavigateToAdmin    object
```

```
enum class AnimationType
─────
Entries (3)
· FLASH_AND_GLOW
· GLOW_ONLY
· NO_ANIMATION
```

KDoc comments (`/** ... */` and `//` blocks) are extracted and displayed with formatted `@param`, `@return`, `@throws`, `@see`, and `@deprecated` tags.

### Copy FQN

Right-click any symbol in a Kotlin file and choose **Kotlin Nav: Copy FQN**, or use `Cmd+Shift+P` → *Kotlin Nav: Copy FQN*.

The fully qualified name is copied to your clipboard and shown in a notification:

```
Copied: ca.lapresse.android.lapresseplus.mainV2.ui.kiosk.KioskViewModel
```

Useful when writing import statements by hand or referencing a class in documentation.

### Import resolution

The extension reads your import statements to disambiguate symbols that exist in multiple packages.

```kotlin
import com.example.ui.Button  // ← extension uses this to pick the right "Button"

val b = Button()  // Cmd+Click → goes to com.example.ui.Button, not any other Button
```

Explicit imports of nested classes are also resolved correctly:

```kotlin
import com.example.OuterClass.InnerClass  // ← resolves to InnerClass inside OuterClass
```

### Multi-module projects

Works automatically with Gradle multi-module projects. The extension reads `settings.gradle` or `settings.gradle.kts` to understand the module structure. The module name appears in hover tooltips and `Cmd+T` results.

### Jetpack Compose

`@Composable` functions are indexed as a separate kind and navigate correctly. The hover shows `@Composable` above the function signature.

```kotlin
@Composable
fun HomeScreen() { ... }  // ← indexed, navigable, hover shows @Composable
```

Use `@compose:` in `Cmd+T` to list only Composable functions.

### Test file isolation

When navigating from main source files, the extension never jumps to symbols defined in test directories (`/test/`, `/androidTest/`). This prevents false matches where a mock field in a test class has the same name as a production symbol.

---

## Status bar

After activation you will see a status bar item on the bottom right:

| State | Meaning |
|---|---|
| `⟳ Kotlin Nav: indexing…` | Building the symbol index for the first time |
| `⟳ Kotlin Nav: updating 12 files…` | Re-scanning files that changed since last open |
| `⟳ Kotlin Nav: re-indexing…` | Manual re-index in progress |
| `◈ Kotlin Nav: 14,532 symbols` | Index is ready — hover to see file count and time taken |

The index is **saved to disk** when you close VS Code. On the next open, the extension restores from the snapshot and only re-parses files that changed — making repeat activations nearly instant.

---

## Configuration

Open **Settings** (`Cmd+,`) and search for `Kotlin Nav`, or add these to your `settings.json`:

```jsonc
{
  // Glob patterns to exclude from indexing (default shown)
  "kotlinNav.excludePatterns": [
    "**/build/**",
    "**/.gradle/**",
    "**/generated/**",
    "**/.idea/**"
  ],

  // Hard cap on files indexed — raise for very large monorepos
  "kotlinNav.maxIndexedFiles": 10000,

  // Parallel file reads during initial scan (default: 20)
  "kotlinNav.concurrency": 20,

  // Parser threads for CPU-parallel symbol extraction (1–8, default: 4)
  "kotlinNav.parserWorkers": 4
}
```

### Tuning for large monorepos

If you have a project with 5,000+ Kotlin files:

```jsonc
{
  "kotlinNav.maxIndexedFiles": 20000,
  "kotlinNav.concurrency": 30,
  "kotlinNav.parserWorkers": 8
}
```

If you want to exclude a large generated module:

```jsonc
{
  "kotlinNav.excludePatterns": [
    "**/build/**",
    "**/.gradle/**",
    "**/generated/**",
    "**/proto/**"
  ]
}
```

---

## Installation

### From VSIX (recommended)

1. Download or build `kotlin-nav-0.1.0.vsix`
2. In VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX…** → select the file
3. Reload VS Code

Or from the terminal:
```bash
code --install-extension kotlin-nav-0.1.0.vsix
```

### Build from source

```bash
git clone <repo>
cd kotlin-nav
npm install
npm run compile          # development build
# or
npm run vscode:prepublish  # production (minified) build
```

Then package:
```bash
npm install -g @vscode/vsce
vsce package --no-dependencies
code --install-extension kotlin-nav-0.1.0.vsix
```

After making changes, rebuild and reinstall:
```bash
node esbuild.js --production && vsce package --no-dependencies && code --install-extension kotlin-nav-0.1.0.vsix
```

Then reload VS Code: `Cmd+Shift+P` → **Developer: Reload Window**

---

## Known limitations

These are inherent to a regex-based approach (no full compiler):

- **Overloaded functions** — if two classes both define `fun save()`, Cmd+Click shows both in a peek list for you to choose
- **Type inference** — `val x = SomeClass()` navigates to `SomeClass` by name, not by inferring the type of `x`
- **Extension functions** — receiver types are not tracked; `String.myExt()` is indexed as `myExt`, not as a member of `String`
- **Find All References noise** — results include occurrences in comments and strings (no AST to filter them out)
- **Generated code** — files inside `build/` are excluded by default

---

## How it works (under the hood)

```
Activation
  ├─ Register providers immediately (Cmd+Click, Hover, Outline, References ready)
  ├─ Load index snapshot from disk (if exists)
  │    ├─ stat() each .kt / .java file → re-parse only changed ones
  │    └─ Restore symbol table from snapshot (no regex, no I/O)
  └─ Full scan if no snapshot
       ├─ 20 concurrent file reads (vscode.workspace.fs)
       └─ 4 parser worker threads (Node.js worker_threads)
            └─ regex patterns → symbol table (3× O(1) Maps)

Cmd+Click
  ├─ Extract word at cursor
  ├─ Resolve imports → FQN candidates (pkg.Outer.Inner, filtered: no test paths)
  ├─ Map.get(fqn) → O(1) lookup
  └─ Return vscode.Location → jump

Find All References
  ├─ Confirm symbol is indexed (name lookup)
  ├─ 20 concurrent file reads across all indexed files
  ├─ \bsymbolName\b regex scan per line
  └─ Return vscode.Location[] → References panel

Cmd+T
  ├─ Parse @tag:name prefix (kind filter)
  ├─ Prefix match → binary search O(log N)
  ├─ Fuzzy match → sequential char scan O(N), scored + sorted
  └─ Filter by kind if @tag was present

Hover
  ├─ Resolve symbol entry (FQN → name fallback)
  ├─ openTextDocument(entry.uri) — from VS Code cache if already open
  ├─ Read signature forward from declaration line (paren-balanced)
  ├─ Read KDoc backward from declaration line
  └─ For sealed/enum: collect direct children from file symbol list

Outline
  ├─ getFileSymbols(uri) → O(1) Map lookup
  ├─ Build tree using depth field (braceDepth at parse time)
  ├─ Read visibility from declaration line → detail text + icon selection
  └─ Return DocumentSymbol[] hierarchy
```

Total Cmd+Click latency after index is warm: **< 1 ms**.
