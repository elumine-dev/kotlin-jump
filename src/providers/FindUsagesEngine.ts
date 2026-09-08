import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString, isInsideStringInterpolation, countTripleQuotes } from '../util/textUtils';
import { decodeUtf8 } from '../util/encoding';
import { leavesBlockCommentOpen } from '../util/LocalScopeIndex';
import { Logger } from '../util/logger';

// ── Internal: wildcard import extraction ─────────────────────────────────────

/**
 * Extracts the package prefix of every wildcard import in `text`.
 * e.g. `import com.example.*` → `"com.example"`.
 */
function extractWildcardPrefixes(text: string): string[] {
  const prefixes: string[] = [];
  // \r? handles Windows CRLF files: after \n the next char is \r, not 'i'
  const re = /^\r?import\s+([\w.]+)\.\*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    prefixes.push(m[1]);
  }
  return prefixes;
}

import picomatch from 'picomatch';

const CONCURRENCY = 20;

// Kotlin reserved words that can also be used as method names (e.g. `repository.catch()`).
// When searching for a word in this set, only accept matches that are dot-qualified
// (preceded by '.') to avoid matching language keywords like `catch (e: Exception)`.
const KOTLIN_KEYWORDS = new Set([
  'abstract', 'annotation', 'as', 'break', 'by', 'catch', 'class',
  'companion', 'const', 'constructor', 'continue', 'crossinline',
  'do', 'dynamic', 'else', 'enum', 'external', 'false',
  'final', 'finally', 'for', 'fun', 'if', 'import',
  'in', 'infix', 'init', 'inline', 'inner', 'interface', 'internal', 'is',
  'it', 'lateinit', 'noinline', 'null', 'object', 'operator',
  'override', 'package', 'private', 'protected', 'public',
  'reified', 'return', 'sealed', 'setparam', 'super',
  'suspend', 'tailrec', 'this', 'throw', 'true', 'try', 'typealias', 'typeof',
  'val', 'var', 'vararg', 'when', 'where', 'while',
]);
// Soft keywords that are everyday property names: `val data: T` in a
// Resource wrapper, `value` in a Setting, `actual` in every test. They were
// in the set above, so only `.data` counted: the declaration and `data == null`
// stayed behind on rename, and F2 on `value` did nothing. A match is a use
// unless it sits in a modifier position (`data class`, `value class`,
// `actual fun`, `out T`) or is an annotation use-site target (`@field:`).
const SOFT_KEYWORDS = new Set([
  'data', 'value', 'field', 'file', 'get', 'set', 'open', 'out', 'param',
  'property', 'receiver', 'delegate', 'expect', 'actual',
]);
const SOFT_MODIFIER_POSITION = /^\s+(?:class|fun|val|var|object|interface|inner|abstract|open|data|sealed|enum|annotation|suspend|override|private|protected|internal|public|final|inline|infix|operator|tailrec|companion|constructor|typealias|[A-Z]\w*\b)/;
function softKeywordIsIdentifier(line: string, at: number, word: string): boolean {
  if (at > 0 && line[at - 1] === '@') return false;           // @field:, @get:, @param:
  const after = line.slice(at + word.length);
  if (SOFT_MODIFIER_POSITION.test(after)) return false;       // data class, actual fun, out T
  if ((word === 'get' || word === 'set') && /^\s*\(/.test(after) && /^\s*(?:private\s+|protected\s+|internal\s+)?$/.test(line.slice(0, at))) return false; // accessor
  return true;
}

// ── File content cache ────────────────────────────────────────────────────────
// Keyed by URI string. Populated on first read, invalidated on file change.
// Eliminates repeated disk I/O across consecutive Find-Usages calls.
const _contentCache = new Map<string, string>();

/** Called by the FileWatcher callback whenever a file is indexed/deleted. */
export function invalidateContentCache(uriString: string): void {
  _contentCache.delete(uriString);
}

export function clearContentCache(): void {
  _contentCache.clear();
}

/**
 * Returns file content, preferring (in order):
 *  1. In-memory VS Code document (already open in an editor — free)
 *  2. Local content cache (already read this session — free)
 *  3. Disk read (populates cache for future calls)
 */
async function readCachedFile(uri: vscode.Uri, uriString: string): Promise<string> {
  const openDoc = vscode.workspace.textDocuments?.find(d => d.uri.toString() === uriString);
  if (openDoc) return openDoc.getText();
  const hit = _contentCache.get(uriString);
  if (hit !== undefined) return hit;
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = decodeUtf8(bytes);
  _contentCache.set(uriString, text);
  return text;
}

export const DEFAULT_TEST_SEGMENTS: string[] = [];

// ── Shared exclude filter (used by ReferenceProvider + CallHierarchyProvider) ──
let _matcherKey = '';
let _matchers: ((path: string) => boolean)[] = [];

export function getExcludeMatchers(): ((path: string) => boolean)[] {
  const patterns = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<string[]>('excludeFromReferences', []);
  const key = patterns.join('\0');
  if (key !== _matcherKey) {
    _matcherKey = key;
    _matchers = patterns.map(p => picomatch(p, { dot: true }));
  }
  return _matchers;
}

// Path extraction is on the hot scan path: a workspace open invokes
// `isExcluded(...)` once per indexed file (5K+ on real projects).
// `vscode.Uri.parse` allocates an object and re-decodes the path every
// time. We cache the decoded path per uriString — the same URI is
// checked many times across one Cmd+Click + Find Usages flow. Bounded
// to avoid heap growth in long-running sessions where files come and go.
const _pathCache = new Map<string, string>();
const _PATH_CACHE_LIMIT = 16384; // ~3 MB worst case at ~200 B/entry

function pathOf(uriString: string): string {
  let p = _pathCache.get(uriString);
  if (p !== undefined) return p;
  // Fast path for `file://...` (the common case): skip Uri.parse, just
  // decode percent-escapes. `decodeURIComponent` throws on malformed
  // `%XX` — fall back to `Uri.parse` (more tolerant) on failure rather
  // than crashing the scan loop. Real-world VS Code emits well-formed
  // URIs so the catch should be cold-path.
  if (uriString.startsWith('file://')) {
    try {
      p = decodeURIComponent(uriString.slice(7));
    } catch {
      p = vscode.Uri.parse(uriString).path;
    }
  } else {
    p = vscode.Uri.parse(uriString).path;
  }
  if (_pathCache.size >= _PATH_CACHE_LIMIT) _pathCache.clear();
  _pathCache.set(uriString, p);
  return p;
}

export function isExcluded(uriString: string): boolean {
  const matchers = getExcludeMatchers();
  if (matchers.length === 0) return false;
  const p = pathOf(uriString);
  return matchers.some(m => m(p));
}

export interface UsageResult {
  uri: vscode.Uri;
  uriString: string;
  line: number;      // 0-based
  character: number; // 0-based
  lineText: string;  // raw line (not trimmed)
}

/**
 * Determines which specific declaration of `word` the given document is most
 * likely referencing. Returns `undefined` when ambiguous.
 *
 * Resolution priority:
 *   1. Exact/wildcard FQN import match via resolveBest
 *   2. Only one declaration exists globally
 *   3. Parent-class visibility: for members (enum entries, companion consts)
 *      whose simple name isn't imported directly, check which declaration's
 *      enclosing class is imported / in the same package as the caller document.
 */
export function resolveSearchTarget(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
): SymbolEntry | undefined {
  const decls = index.lookup(word);
  if (decls.length === 0) return undefined;

  // Same-file preference. When several files in the same package each declare
  // a top-level `private fun foo`, they all share the FQN `pkg.foo`. The FQN
  // map only keeps one of them, so `resolveBest` would silently pick whichever
  // was indexed last — sending Find Usages and Cmd+Click to an unrelated file.
  // If the cursor's own file declares the symbol, that declaration is THE
  // target by construction.
  if (decls.length > 1) {
    const docUriStr = document.uri.toString();
    const sameFile = decls.find(d => d.uri.toString() === docUriStr);
    if (sameFile) return sameFile;
  }

  let target: SymbolEntry | undefined;
  const resolved = resolveBest(word, document, fqn => index.lookupFqn(fqn));
  if (resolved.matches.length === 1) target = resolved.matches[0];
  if (!target && decls.length === 1) target = decls[0];

  // For member symbols (enum entries, companion constants, etc.) whose simple
  // name isn't directly imported, the word-level resolveBest above fails.
  // Disambiguate by checking which declaration's parent class is visible in
  // the caller document (same package, explicit import, or wildcard import).
  if (!target && decls.length > 1) {
    const docText = document.getText();
    const candidates = decls.filter(d => fileCouldReference(docText, d, index));
    if (candidates.length === 1) {
      target = candidates[0];
    } else if (candidates.length > 1) {
      // Same-file tiebreak: when the search originates from the declaring file
      // (e.g. Find Usages on `clickStream` inside LoginViewModel.kt), and both
      // LoginViewModel.clickStream and NavigationViewModelDelegate.clickStream
      // are in the same package, prefer the one declared in this exact file.
      const sameFile = candidates.filter(d => d.uri.toString() === document.uri.toString());
      if (sameFile.length === 1) target = sameFile[0];
    }
  }

  return target;
}

/**
 * Core scanner — `target` is already resolved by the caller.
 * Use this when the declaring symbol is known (e.g. CodeLens) to skip the
 * import-resolution step and avoid opening the declaring document.
 */
export async function scanForUsagesWithTarget(
  word: string,
  target: SymbolEntry | undefined,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
  log?: Logger,
): Promise<UsageResult[]> {
  if (index.lookup(word).length === 0) return [];

  // ── Pre-filter via word index or private restriction ─────────────────────
  let effectiveUris = uriStrings;
  // `private` (top-level OR class member) has no cross-file callers in
  // valid Kotlin/Java — restrict to the declaring file. Note this is
  // STRICTER than the lenient rule used by the Definition resolver, which
  // stays lenient on class members (`depth > 0`) so Cmd+Click on
  // `instance.privateMember` from another file still resolves (helpful
  // UX, even if the call wouldn't compile). Find Usages picks the
  // conservative scope: only places where the call could actually compile.
  if (target?.isPrivate) {
    effectiveUris = uriStrings.filter(u => u === target.uri.toString());
    log?.info(`[findUsages] "${word}" is private → declaring file only (was ${uriStrings.length} files)`);
  } else {
    const candidates = index.getFilesContainingWord(word, target ?? undefined);
    if (candidates !== null) {
      effectiveUris = uriStrings.filter(u => candidates.has(u));
      log?.info(`[findUsages] word index: ${effectiveUris.length}/${uriStrings.length} candidates for "${word}"`);
    } else {
      const targetDesc = target ? target.fqn : 'ambiguous';
      log?.info(`[findUsages] "${word}" target=${targetDesc} — word index not ready, full scan (${uriStrings.length} files)`);
    }
  }

  const maxReferences = vscode.workspace.getConfiguration('kotlinJump').get<number>('maxReferences', 500);
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: UsageResult[] = [];
  const skipped: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < effectiveUris.length) {
      if (token.isCancellationRequested) return;
      if (results.length >= maxReferences) return;
      const uriStr = effectiveUris[cursor++];
      const uri = vscode.Uri.parse(uriStr);
      try {
        const text = await readCachedFile(uri, uriStr);

        if (!text.includes(word)) continue;
        if (target && !fileCouldReference(text, target, index)) {
          skipped.push(uriStr);
          continue;
        }
        // `import com.app.model.User as DomainUser` makes the file a
        // referencer, but its bare `User` is another declaration: only the
        // import line (handled by scanImports) names the target here.
        if (target && importedOnlyAsAlias(text, target)) continue;

        const fileHitsBefore = results.length;
        const lines = text.split('\n');
        let inBlockComment = false;
        // Lines inside a `"""` raw string are text: only a `$name` or a
        // `${…}` template on them references the symbol. A multi-line SQL
        // string used to count every `id` in it as a usage.
        let inRawString = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // `scan` is `line` with a leading comment or raw-string tail
          // blanked, so the string/comment classifier starts in code.
          let scan = line;
          let codeStart = 0; // first column that is code
          let rawEnd = -1;   // end of the raw-string text on this line
          if (inRawString) {
            const close = line.indexOf('"""');
            if (close < 0) {
              codeStart = rawEnd = line.length;
            } else {
              codeStart = rawEnd = close + 3;
              scan = ' '.repeat(codeStart) + line.slice(codeStart);
              inRawString = false; // le reste de la ligne est du code, relu plus bas
            }
          } else if (inBlockComment) {
            const close = line.indexOf('*/');
            if (close < 0) continue; // still inside block comment — skip entire line
            inBlockComment = false;
            codeStart = close + 2;
            scan = ' '.repeat(codeStart) + line.slice(codeStart);
          }
          if (codeStart < line.length) {
            const trimmed = scan.trimStart();
            if (
              trimmed.startsWith('import ') ||
              trimmed.startsWith('//') ||
              (trimmed.startsWith('*') && !trimmed.startsWith('*/'))
            ) continue;
            // Un seul balayage décide des deux états. Compter les `"""` de la
            // ligne entière prenait un `// TODO passer en """` pour l'ouverture
            // d'une chaîne brute : tout le reste du fichier devenait du texte,
            // les usages disparaissaient et le renommage laissait l'ancien nom.
            const carried = advanceLineState(scan, codeStart);
            inRawString = carried.raw;
            inBlockComment = carried.block;
          }

          wordRe.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = wordRe.exec(line)) !== null) {
            if (results.length >= maxReferences) break;
            if (m.index < codeStart) {
              // Comment text is never a reference; raw-string text only through a template.
              if (!(m.index < rawEnd && inRawTemplate(line, m.index))) continue;
            } else if (isInsideCommentOrString(scan, m.index)) {
              // `"Hello $name"` and `"${name}"` are code: a rename that
              // skipped them left the template pointing at the old name.
              // `"\$amount"` is an escaped dollar, and a `// … $name` comment is a comment.
              const escapedDollar = m.index >= 2 && scan[m.index - 1] === '$' && scan[m.index - 2] === '\\';
              const shortInterp = m.index >= 1 && scan[m.index - 1] === '$' && !escapedDollar;
              const commentAt = lineCommentStart(scan);
              if (commentAt >= 0 && commentAt < m.index) continue;
              if (insideBlockCommentOnLine(scan, m.index)) continue;
              if (!shortInterp && !isInsideStringInterpolation(scan, m.index)) continue;
            }
            // Kotlin keyword used as method name (e.g. .catch()): require a dot qualifier
            // to avoid matching language constructs like `catch (e: Exception)`.
            if (KOTLIN_KEYWORDS.has(word) && (m.index === 0 || line[m.index - 1] !== '.')) continue;
            if (SOFT_KEYWORDS.has(word) && !softKeywordIsIdentifier(line, m.index, word)) continue;
            results.push({ uri, uriString: uriStr, line: i, character: m.index, lineText: line });
          }
        }
        const hitsInFile = results.length - fileHitsBefore;
        if (hitsInFile > 0 && log) {
          const name = uri.path.split('/').pop() ?? uri.path;
          log.info(`[findUsages]   ${name}: ${hitsInFile} hit${hitsInFile === 1 ? '' : 's'}`);
        }
      } catch { /* skip unreadable */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (log) {
    const fileCount = results.length === 0 ? 0 : new Set(results.map(r => r.uriString)).size;
    log.info(`[findUsages] "${word}" → ${results.length} total result${results.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`);
    if (skipped.length > 0) {
      log.info(`[findUsages]   skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} (fileCouldReference=false): ${skipped.map(u => u.split('/').pop()).join(', ')}`);
    }
  }

  return results;
}

/** Resolves the target then delegates to the core scanner. */
export async function scanForUsages(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
  log?: Logger,
): Promise<UsageResult[]> {
  if (index.lookup(word).length === 0) return [];
  const target = resolveSearchTarget(word, document, index);
  return scanForUsagesWithTarget(word, target, index, uriStrings, token, log);
}

/**
 * Scans `uriStrings` for import lines containing `word`.
 * Used by RenameProvider to update import statements, which scanForUsages skips.
 */
export async function scanImports(
  word: string,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
  target?: SymbolEntry | null,
): Promise<UsageResult[]> {
  if (index.lookup(word).length === 0) return [];

  const maxReferences = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<number>('maxReferences', 500);
  const results: UsageResult[] = [];
  let cursor = 0;
  // Only the imported name itself, and only when it is the renamed symbol.
  // Any `\bword\b` on an import line used to qualify: renaming `State`
  // rewrote `import androidx.compose.runtime.State`, and renaming a property
  // `repository` rewrote `import com.app.repository.UserRepo`.
  const importRe = /^(\s*import\s+(?:static\s+)?)([\w.]+)(?:\.\*)?(?:\s+as\s+(\w+))?/;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested) return;
      if (results.length >= maxReferences) return;
      const uriStr = uriStrings[cursor++];
      const uri = vscode.Uri.parse(uriStr);
      try {
        const text = await readCachedFile(uri, uriStr);
        if (!text.includes(word)) continue;

        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxReferences) break;
          const im = importRe.exec(lines[i]);
          if (!im) continue;
          const path = im[2];
          const lastDot = path.lastIndexOf('.');
          const lastSegment = lastDot >= 0 ? path.slice(lastDot + 1) : path;
          if (lastSegment !== word) continue;
          if (target && target.fqn !== path) continue;
          const character = im[1].length + (lastDot >= 0 ? lastDot + 1 : 0);
          results.push({ uri, uriString: uriStr, line: i, character, lineText: lines[i] });
        }
      } catch { /* skip unreadable */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// Cached `^\s*package\s+pkg(?:\s|;|$)` patterns. Find Usages calls
// `fileCouldReference` once per candidate file (potentially hundreds);
// each invocation rebuilt a fresh RegExp for the same package name.
const _packageRegexCache = new Map<string, RegExp>();
function packageRegex(pkg: string): RegExp {
  let re = _packageRegexCache.get(pkg);
  if (!re) {
    re = new RegExp(`^\\s*package\\s+${escapeRegex(pkg)}(?:\\s|;|$)`, 'm');
    _packageRegexCache.set(pkg, re);
  }
  return re;
}

/**
 * L'état de fin de ligne, en un seul balayage du code : chaîne brute ouverte,
 * commentaire de bloc ouvert, ou ni l'un ni l'autre. Un `//` arrête la ligne,
 * une chaîne simple est sautée d'un bloc (un `http://` n'est pas un
 * commentaire), et ce qui est écrit dans un commentaire n'ouvre rien.
 */
export function advanceLineState(
  text: string,
  from = 0,
  start: { raw: boolean; block: boolean } = { raw: false, block: false },
): { raw: boolean; block: boolean } {
  let raw = start.raw;
  let block = start.block;
  let i = from;
  while (i < text.length) {
    if (raw) {
      if (text.startsWith('"""', i)) { raw = false; i += 3; } else i++;
      continue;
    }
    if (block) {
      const close = text.indexOf('*/', i);
      if (close === -1) return { raw, block: true };
      block = false;
      i = close + 2;
      continue;
    }
    if (text.startsWith('"""', i)) { raw = true; i += 3; continue; }
    if (text.startsWith('//', i)) return { raw, block };
    if (text.startsWith('/*', i)) { block = true; i += 2; continue; }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return { raw, block };
}

/**
 * Inside a raw string, `$name` and `${…name…}` are the only places where
 * `name` is code. Raw strings have no escapes, so a `$` is always a template.
 */
function inRawTemplate(line: string, index: number): boolean {
  if (index > 0 && line[index - 1] === '$') return true;
  let braces = 0;
  for (let i = 0; i < index; i++) {
    if (braces === 0) {
      if (line[i] === '$' && line[i + 1] === '{') { braces = 1; i++; }
    } else if (line[i] === '{') braces++;
    else if (line[i] === '}') braces--;
  }
  return braces > 0;
}

/**
 * Drops the declaration token itself from a scan: the name at
 * (line, character) in the declaring file. Only that token, so a recursive
 * call or a second mention on the declaration line still counts, and the
 * lens count agrees with the panel. When no hit sits at that column
 * (backtick names), the first hit on the line is the declaration.
 */
export function withoutDeclaration(
  results: UsageResult[],
  uriString: string,
  line: number,
  character?: number,
): UsageResult[] {
  let idx = character === undefined
    ? -1
    : results.findIndex(r => r.uriString === uriString && r.line === line && r.character === character);
  if (idx < 0) idx = results.findIndex(r => r.uriString === uriString && r.line === line);
  if (idx < 0) return results;
  return results.filter((_, i) => i !== idx);
}

const RE_ANY_PACKAGE = /^\s*package\s+[\w.]+/m;

/**
 * Returns true if a file could plausibly reference the target symbol.
 * Checks: same package, explicit FQN import, or wildcard package import.
 *
 * When `index` is provided, the wildcard check is tightened: if another
 * wildcard import in the file covers a symbol with the same simple name from
 * a different package, the match is considered ambiguous and returns false.
 */
export function fileCouldReference(text: string, target: SymbolEntry, index?: SymbolIndex): boolean {
  const { fqn, packageName: pkg } = target;
  if (pkg) {
    // Anchor to start of line (multiline ^) so a `// package foo` comment never matches.
    if (packageRegex(pkg).test(text)) return true;
  } else if (!RE_ANY_PACKAGE.test(text)) {
    // Both in the default package, the target's own file included: no
    // import check below could accept them, and the lens said "0 usages".
    return true;
  }
  if (importedExactly(text, fqn)) return true;
  // For member FQNs (pkg.Class.method), also check import of the containing class
  const lastDot = fqn.lastIndexOf('.');
  if (lastDot > 0) {
    const parentFqn = fqn.substring(0, lastDot);
    if (importedExactly(text, parentFqn)) return true;
  }
  if (pkg && importedExactly(text, `${pkg}.*`)) {
    // With an index we can check whether another wildcard in this file also exports
    // a symbol with the same simple name, which would make the reference ambiguous.
    // Only applies to top-level symbols (depth === 0): wildcard imports bring package-level
    // declarations into scope, not class members — so member symbols are never ambiguous
    // via wildcards and should not be penalised by a competing top-level function name.
    if (index && target.depth === 0) {
      const hasCompeting = extractWildcardPrefixes(text).some(
        prefix => prefix !== pkg && index.lookupFqn(`${prefix}.${target.name}`) !== undefined,
      );
      if (hasCompeting) return false;
    }
    return true;
  }
  return false;
}

/**
 * True when `text` contains `import <path>` where the path is not a prefix of
 * a longer identifier (e.g. `import pkg.FooBarExtended` must NOT match `pkg.FooBar`).
 */
/**
 * True when the target's FQN reaches this file only through an aliased
 * import: no plain import of it, no same-package visibility, no wildcard of
 * its package. Members are never aliased themselves (the alias is on their
 * class), so this only concerns top-level declarations.
 */
function importedOnlyAsAlias(text: string, target: SymbolEntry): boolean {
  if (target.depth !== 0) return false;
  // Two RegExps per scanned file otherwise: only build them when the text can
  // hold an aliased import of this FQN at all.
  if (!text.includes(target.fqn + ' as ')) return false;
  const fqn = escapeRegex(target.fqn);
  if (!new RegExp(`^\\s*import\\s+${fqn}\\s+as\\s+\\w+`, 'm').test(text)) return false;
  if (new RegExp(`^\\s*import\\s+${fqn}\\s*(?:;|//|$)`, 'm').test(text)) return false;
  const pkg = target.packageName;
  if (pkg && packageRegex(pkg).test(text)) return false;
  if (pkg && importedExactly(text, `${pkg}.*`)) return false;
  return true;
}

function importedExactly(text: string, importPath: string): boolean {
  if (matchesImportNeedle(text, `import ${importPath}`)) return true;
  // Java's `import static a.b.C.MAX;` never matches the plain needle. Guard
  // the second pass behind one indexOf so the Kotlin hot path, which is the
  // common case, pays almost nothing for a form it does not have.
  if (!text.includes('import static ')) return false;
  return matchesImportNeedle(text, `import static ${importPath}`);
}

function matchesImportNeedle(text: string, needle: string): boolean {
  let start = 0;
  while (true) {
    const idx = text.indexOf(needle, start);
    if (idx === -1) return false;
    const after = text[idx + needle.length];
    // Valid end: end-of-string, whitespace, semicolon — but NOT a word/dot character
    if (after === undefined || (after !== '.' && !/\w/.test(after))) return true;
    start = idx + 1;
  }
}

export { isInsideCommentOrString } from '../util/textUtils';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index of the first `//` outside string literals, or -1. */
function lineCommentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

// True when a block comment opens before `index` on this line and is not closed before it.
function insideBlockCommentOnLine(line: string, index: number): boolean {
  const open = line.lastIndexOf('/*', index);
  if (open < 0) return false;
  return line.indexOf('*/', open + 2) === -1 || line.indexOf('*/', open + 2) > index;
}
