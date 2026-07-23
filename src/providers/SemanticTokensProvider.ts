import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString } from '../util/textUtils';
import { resolveLocalScope } from './DefinitionProvider';

// ── Legend arrays (order = index) ────────────────────────────────────────────

export const TOKEN_TYPES: string[] = [
  'namespace',     // 0
  'class',         // 1
  'struct',        // 2  — data class
  'enum',          // 3
  'interface',     // 4
  'type',          // 5  — object / typealias
  'typeParameter', // 6
  'property',      // 7  — member val/var
  'enumMember',    // 8
  'function',      // 9  — top-level fun
  'method',        // 10 — member fun
  'operator',      // 11
  'decorator',     // 12 — annotation class
  'variable',      // 13 — top-level val/var
];

export const TOKEN_MODIFIERS: string[] = [
  'declaration',  // 0
  'readonly',     // 1
  'async',        // 2  — suspend / coroutine / side-effect
  'static',       // 3  — top-level (depth === 0)
  'abstract',     // 4
  'modification', // 5
  'deprecated',   // 6
  'composable',   // 7  — @Composable or Compose state API
  'sealed',       // 8
  'extension',    // 9  — fun with receiver type
  'inline',       // 10
  'infix',        // 11
  'lateinit',     // 12
  'operator',     // 13 — operator fun
  'override',     // 14 — override fun / override val
];

// ── Bit masks for each modifier ───────────────────────────────────────────────
const M_DECLARATION  = 1 << 0;
const M_READONLY     = 1 << 1;
const M_ASYNC        = 1 << 2;
const M_STATIC       = 1 << 3;
const M_ABSTRACT     = 1 << 4;
const M_MODIFICATION = 1 << 5;
const M_DEPRECATED   = 1 << 6;
const M_COMPOSABLE   = 1 << 7;
const M_SEALED       = 1 << 8;
const M_EXTENSION    = 1 << 9;
const M_INLINE       = 1 << 10;
const M_INFIX        = 1 << 11;
const M_LATEINIT     = 1 << 12;
const M_OPERATOR     = 1 << 13;
const M_OVERRIDE     = 1 << 14;

// ── SymbolKind → token type index ────────────────────────────────────────────

function kindToTypeIndex(kind: SymbolKind, depth: number): number | undefined {
  switch (kind) {
    case 'class':       return 1;
    case 'dataClass':   return 2;
    case 'sealedClass': return 1;
    case 'interface':   return 4;
    case 'object':      return 5;
    case 'annotation':  return 12;
    case 'typealias':   return 5;
    case 'enum':        return depth > 0 ? 8 : 3; // enumMember vs enum class
    case 'fun':
    case 'composable':  return depth === 0 ? 9 : 10;
    case 'val':
    case 'var':         return depth === 0 ? 13 : 7;
    default:            return undefined;
  }
}

// ── Modifier bitmask from a SymbolEntry ───────────────────────────────────────

function buildModifiers(entry: SymbolEntry, isDeclaration: boolean): number {
  let mods = 0;

  if (isDeclaration)    mods |= M_DECLARATION;
  if (entry.isAbstract) mods |= M_ABSTRACT;
  // Standard modifier: themes render it as strikethrough, declarations and
  // resolved usages both.
  if (entry.isDeprecated) mods |= M_DEPRECATED;
  if (entry.isSuspend)  mods |= M_ASYNC;
  if (entry.isInline)   mods |= M_INLINE;
  if (entry.isInfix)    mods |= M_INFIX;
  if (entry.isExtension) mods |= M_EXTENSION;
  if (entry.isLateinit)     mods |= M_LATEINIT;
  if (entry.isHiltViewModel) mods |= M_ASYNC; // async because lifecycle-managed
  if (entry.isOperator)     mods |= M_OPERATOR;
  if (entry.isOverride)     mods |= M_OVERRIDE;

  const k = entry.kind;

  if (k === 'val' || entry.isConst)    mods |= M_READONLY;
  if (k === 'var' && !isDeclaration)   mods |= M_MODIFICATION;
  if (k === 'composable' || entry.isComposable) mods |= M_COMPOSABLE;
  if (k === 'sealedClass')             mods |= M_SEALED;

  // static = top-level callable or property
  if (entry.depth === 0 && (k === 'fun' || k === 'composable' || k === 'val' || k === 'var' || k === 'object')) {
    mods |= M_STATIC;
  }

  return mods;
}

// ── Hardcoded Kotlin/Compose stdlib API sets ──────────────────────────────────

// composable + readonly — Compose state management APIs
const COMPOSE_STATE = new Set([
  'remember', 'rememberSaveable', 'rememberUpdatedState',
  'mutableStateOf', 'mutableIntStateOf', 'mutableFloatStateOf', 'mutableLongStateOf',
  'derivedStateOf', 'produceState', 'collectAsState', 'collectAsStateWithLifecycle',
]);

// async + composable — Compose side-effect APIs with explicit lifecycle semantics
const COMPOSE_EFFECTS = new Set([
  'LaunchedEffect', 'DisposableEffect', 'SideEffect',
  'rememberCoroutineScope', 'snapshotFlow',
]);

// async — Coroutines scope/context functions
const COROUTINES_SCOPE = new Set([
  'launch', 'async', 'withContext', 'coroutineScope', 'supervisorScope',
  'withTimeout', 'withTimeoutOrNull', 'runBlocking', 'runCatching',
]);

// async — Hot Flow types (always active, different from cold Flow)
const FLOW_HOT = new Set([
  'StateFlow', 'SharedFlow', 'MutableStateFlow', 'MutableSharedFlow',
]);

// Kotlin keywords to skip during reference scanning
const KOTLIN_KEYWORDS = new Set([
  'fun', 'val', 'var', 'class', 'if', 'else', 'when', 'for', 'while', 'do',
  'return', 'override', 'open', 'sealed', 'data', 'suspend', 'inline', 'object',
  'interface', 'enum', 'import', 'package', 'is', 'as', 'in', 'by', 'it',
  'this', 'super', 'null', 'true', 'false', 'throw', 'try', 'catch', 'finally',
  'break', 'continue', 'typealias', 'annotation', 'abstract', 'private',
  'protected', 'internal', 'public', 'companion', 'init', 'constructor',
  'get', 'set', 'field', 'property', 'operator', 'infix', 'external', 'const',
  'lateinit', 'actual', 'expect', 'reified', 'crossinline', 'noinline', 'tailrec',
]);

const WORD_RE = /\b[A-Za-z_]\w{1,}\b/g; // min 2 chars

// ── Per-document token cache ──────────────────────────────────────────────────

interface CachedTokens {
  version:  number;
  resultId: string;
  data:     Uint32Array;
}

interface TokenEntry {
  line: number;
  char: number;
  len:  number;
  type: number;
  mods: number;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class KotlinSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider,
             vscode.DocumentRangeSemanticTokensProvider {

  private readonly cache = new Map<string, CachedTokens>();
  private nextId = 0;

  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeSemanticTokens = this._onChange.event;

  constructor(
    private readonly index: SymbolIndex,
    private readonly legend: vscode.SemanticTokensLegend,
  ) {}

  // ── Full document ─────────────────────────────────────────────────────────

  provideDocumentSemanticTokens(
    doc: vscode.TextDocument,
    ct: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    const cached = this.cache.get(doc.uri.toString());
    if (cached?.version === doc.version) {
      return new vscode.SemanticTokens(cached.data, cached.resultId);
    }
    return this.computeAndCache(doc, null, ct);
  }

  // ── Delta updates — send only changed ints ────────────────────────────────

  provideDocumentSemanticTokensEdits(
    doc: vscode.TextDocument,
    previousResultId: string,
    ct: vscode.CancellationToken,
  ): vscode.SemanticTokens | vscode.SemanticTokensEdits {
    const cached = this.cache.get(doc.uri.toString());

    if (cached?.version === doc.version) {
      return new vscode.SemanticTokensEdits([], cached.resultId);
    }

    const fresh = this.computeAndCache(doc, null, ct);

    if (!cached || cached.resultId !== previousResultId) return fresh;

    return new vscode.SemanticTokensEdits(diffUint32(cached.data, fresh.data), fresh.resultId ?? '');
  }

  // ── Range (viewport-first) ────────────────────────────────────────────────

  provideDocumentRangeSemanticTokens(
    doc: vscode.TextDocument,
    range: vscode.Range,
    ct: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    const result = this.computeAndCache(doc, range, ct);
    // Seed the full-doc cache in the background so subsequent edits use delta
    // diffs. setTimeout, not setImmediate: the latter is Node-only and threw
    // a ReferenceError in the web extension host, failing the whole range
    // request on every freshly opened document.
    if (!this.cache.has(doc.uri.toString())) {
      const cts = new vscode.CancellationTokenSource();
      setTimeout(() => { this.computeAndCache(doc, null, cts.token); cts.dispose(); }, 0);
    }
    return result;
  }

  // ── Cache invalidation (called from FileWatcher after re-index) ───────────

  invalidate(uriString?: string): void {
    if (uriString) this.cache.delete(uriString);
    else this.cache.clear();
    this._onChange.fire();
  }

  dispose(): void {
    this._onChange.dispose();
  }

  // ── Core computation ──────────────────────────────────────────────────────

  private computeAndCache(
    doc: vscode.TextDocument,
    range: vscode.Range | null,
    ct: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    const tokens: TokenEntry[] = [];
    const declKeys = new Set<string>();

    // ── Phase 1: declaration sites (exact, from index) ─────────────────────
    for (const entry of this.index.getFileSymbols(doc.uri.toString())) {
      if (range && (entry.line < range.start.line || entry.line > range.end.line)) continue;
      const type = kindToTypeIndex(entry.kind, entry.depth);
      if (type === undefined) continue;
      tokens.push({
        line: entry.line,
        char: entry.character,
        len:  entry.name.length,
        type,
        mods: buildModifiers(entry, true),
      });
      declKeys.add(`${entry.line}:${entry.character}`);
    }

    // ── Phase 2: reference sites (regex scan) ──────────────────────────────
    const lines = doc.getText().split('\n');
    // Per-run cache: same word resolves identically within one document version.
    // Eliminates redundant resolveBest() calls for repeated symbols.
    const wordCache = new Map<string, SymbolEntry | undefined>();

    for (let li = 0; li < lines.length; li++) {
      if (ct.isCancellationRequested) break;
      if (range && (li < range.start.line || li > range.end.line)) continue;

      const line    = lines[li];
      const trimmed = line.trimStart();

      // Skip comment/import/package lines fast
      if (
        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') ||
        trimmed.startsWith('import ') || trimmed.startsWith('package ')
      ) continue;

      WORD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;

      while ((m = WORD_RE.exec(line)) !== null) {
        const word = m[0];
        const col  = m.index;

        if (KOTLIN_KEYWORDS.has(word)) continue;
        if (declKeys.has(`${li}:${col}`)) continue;
        if (isInsideCommentOrString(line, col)) continue;

        // ── Check hardcoded stdlib sets first (no index lookup needed) ──────
        const hardcoded = resolveHardcoded(word, li, col);
        if (hardcoded) { tokens.push(hardcoded); continue; }

        // ── Resolve from project index ────────────────────────────────────
        let entry: SymbolEntry | undefined;
        if (wordCache.has(word)) {
          entry = wordCache.get(word);
        } else {
          const result = resolveBest(word, doc, fqn => this.index.lookupFqn(fqn));
          // Fallback to global lookup only for PascalCase names (class/object refs) —
          // lowercase names like `name`, `value`, `id` collide too frequently across projects
          const isPascal = word.charCodeAt(0) >= 65 && word.charCodeAt(0) <= 90;
          entry = result.matches[0] ?? (isPascal ? this.index.lookup(word)[0] : undefined);
          wordCache.set(word, entry);
        }
        if (!entry) continue;

        // Local-scope shadows the workspace symbol. Without this guard
        // a parameter named `repository` would be coloured as the
        // workspace top-level `val repository`, which is wrong info.
        // Cheap because we only pay it when an entry is otherwise
        // about to be emitted — most words skip out before this point.
        if (resolveLocalScope(doc, new vscode.Position(li, col), word)) continue;

        const type = kindToTypeIndex(entry.kind, entry.depth);
        if (type === undefined) continue;

        tokens.push({
          line: li,
          char: col,
          len:  word.length,
          type,
          mods: buildModifiers(entry, false),
        });
      }
    }

    // Sort by line then character (required by SemanticTokensBuilder)
    tokens.sort((a, b) => a.line !== b.line ? a.line - b.line : a.char - b.char);

    const builder = new vscode.SemanticTokensBuilder(this.legend);
    for (const t of tokens) builder.push(t.line, t.char, t.len, t.type, t.mods);
    const result = builder.build();

    // Only cache full-document results
    if (!range) {
      const resultId = String(this.nextId++);
      this.cache.set(doc.uri.toString(), { version: doc.version, resultId, data: result.data });
      return new vscode.SemanticTokens(result.data, resultId);
    }
    return result;
  }
}

// ── Hardcoded stdlib token resolution ────────────────────────────────────────

function resolveHardcoded(word: string, line: number, col: number): TokenEntry | undefined {
  if (COMPOSE_STATE.has(word)) {
    return { line, char: col, len: word.length, type: 9, mods: M_COMPOSABLE | M_READONLY };
  }
  if (COMPOSE_EFFECTS.has(word)) {
    return { line, char: col, len: word.length, type: 9, mods: M_ASYNC | M_COMPOSABLE };
  }
  if (COROUTINES_SCOPE.has(word)) {
    return { line, char: col, len: word.length, type: 9, mods: M_ASYNC };
  }
  if (FLOW_HOT.has(word)) {
    return { line, char: col, len: word.length, type: 5, mods: M_ASYNC }; // type = 5 (type)
  }
  return undefined;
}

// ── Minimal Uint32Array diff → single SemanticTokensEdit ─────────────────────

function diffUint32(oldData: Uint32Array, newData: Uint32Array): vscode.SemanticTokensEdit[] {
  let start = 0;
  while (start < oldData.length && start < newData.length && oldData[start] === newData[start]) {
    start++;
  }
  if (start === oldData.length && start === newData.length) return [];

  let oldEnd = oldData.length - 1;
  let newEnd = newData.length - 1;
  while (oldEnd >= start && newEnd >= start && oldData[oldEnd] === newData[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  return [new vscode.SemanticTokensEdit(start, oldEnd - start + 1, newData.slice(start, newEnd + 1))];
}
