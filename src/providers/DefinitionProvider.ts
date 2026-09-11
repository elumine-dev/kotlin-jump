import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { onlineDocsLocation } from './OnlineDocsFallback';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { isTestPath } from '../util/testPaths';
import { buildLocalScopeIndex, latestBinding, signatureEnd, type LocalScopeIndex } from '../util/LocalScopeIndex';
export { buildLocalScopeIndex, type LocalScopeIndex } from '../util/LocalScopeIndex';
import { Logger } from '../util/logger';

const WORD_RE = /[A-Za-z_]\w*/;
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;
const RE_PKG = /^\s*package\s+([\w.]+)/m;
const RE_PKG_LINE = /^\s*package\s+([\w.]+)/;

// Extract the file's `package` declaration without allocating the entire
// document text. The clause is required by Kotlin/Java to be the first
// non-comment, non-blank statement, so 50 lines is a generous upper bound
// even for files with extensive header banners.
function packageOfDocument(doc: { lineCount: number; lineAt: (n: number) => { text: string } }): string {
  const max = Math.min(doc.lineCount, 50);
  for (let i = 0; i < max; i++) {
    const m = RE_PKG_LINE.exec(doc.lineAt(i).text);
    if (m) return m[1];
  }
  return '';
}

// Cached `\bword\b` patterns — `findLocalUsages` is called on every
// Cmd+Click and would otherwise compile a fresh RegExp per invocation.
// Bounded to avoid memory growth on workspaces with thousands of unique
// identifiers.
const _wordRegexCache = new Map<string, RegExp>();
function wordRegex(word: string): RegExp {
  let re = _wordRegexCache.get(word);
  if (!re) {
    re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
    if (_wordRegexCache.size >= 256) _wordRegexCache.clear(); // simple bound
    _wordRegexCache.set(word, re);
  }
  return re;
}
const DEFAULT_TEST_SEGMENTS: string[] = [];

const CLASS_LIKE_KINDS = new Set([
  'class', 'interface', 'object', 'enum', 'dataClass', 'sealedClass', 'annotation',
]);

// Shared state: set by provideDefinition, consumed by the selection listener in extension.ts
let _pendingDeclNav: { uri: string; line: number; word: string } | undefined;
export function getPendingDeclNav() { return _pendingDeclNav; }
export function clearPendingDeclNav() { _pendingDeclNav = undefined; }
/** Test-only: forge a pending state to simulate the post-navigation race
 *  guarded by `navigateFromInlay`. Production code must NEVER call this. */
export function _setPendingDeclNavForTest(p: { uri: string; line: number; word: string } | undefined): void {
  _pendingDeclNav = p;
}

/**
 * When the user cmd+clicks an inlay hint, the wrapper opens a temporal
 * suppression window: the smart-nav selection-change listener must IGNORE
 * any `_pendingDeclNav` state during this window.
 *
 * Why a window and not just clear-before-and-after: VS Code re-fires
 * `provideDefinition` for the new cursor a few hundred milliseconds AFTER
 * the navigation lands (for link decorations / peek hints / hover preview).
 * That call lands AT the parameter declaration, sets `_pendingDeclNav`,
 * and the selection-change event from the navigation itself can still be
 * pending. Without a guard, the listener consumes the freshly-set pending
 * and fires `goToReferences` — opening the Find Usages peek panel on top
 * of the navigation. The window covers that whole post-navigation race.
 */
let _inlayNavSuppressUntilMs = 0;
const INLAY_NAV_SUPPRESS_MS = 800;
export function isInlayNavSuppressed(now = Date.now()): boolean {
  return now < _inlayNavSuppressUntilMs;
}
/** Test-only: read the current suppression deadline. */
export function _getInlayNavSuppressUntilMsForTest(): number {
  return _inlayNavSuppressUntilMs;
}
/** Test-only: forcibly set or clear the suppression deadline. */
export function _setInlayNavSuppressUntilMsForTest(v: number): void {
  _inlayNavSuppressUntilMs = v;
}

/**
 * Inlay-hint navigation wrapper. Bypasses the Definition pipeline, clears
 * `_pendingDeclNav`, and arms a suppression window so the smart-nav listener
 * ignores any pending state set by VS Code's post-navigation refire.
 *
 * Wired to `kotlin-jump._navigateInlay` in extension.ts; exported here so
 * unit tests can exercise the contract.
 */
export async function navigateFromInlay(
  uri: vscode.Uri,
  opts: vscode.TextDocumentShowOptions,
): Promise<void> {
  clearPendingDeclNav();
  _inlayNavSuppressUntilMs = Date.now() + INLAY_NAV_SUPPRESS_MS;
  await vscode.commands.executeCommand('vscode.open', uri, opts);
  clearPendingDeclNav();
  // Re-arm the deadline AFTER open returns: vscode.open's duration is unbounded
  // (slow disks, large files). Anchoring to "open completed + N ms" guarantees
  // we cover the post-nav refire window irrespective of how long open() took.
  _inlayNavSuppressUntilMs = Date.now() + INLAY_NAV_SUPPRESS_MS;
}

export class KotlinDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: SymbolIndex, private readonly log?: Logger) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    _pendingDeclNav = undefined; // clear stale state from previous hover/click
    this.log?.info(`provideDefinition called — ${document.uri.path}:${position.line}:${position.character}`);

    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) { this.log?.info('provideDefinition: no word range'); return null; }

    const word = document.getText(wordRange);
    if (word.length < 2) { this.log?.info(`provideDefinition: word too short "${word}"`); return null; }

    // ── -3. Plain string / comment guard ─────────────────────────────────────
    // Words inside a string literal or comment are not code — they are text.
    // Cmd+Click on `Level` in `Text(text = "Level $level")` must NOT jump
    // anywhere; only `$level` (short interpolation) and `${level}` (full
    // interpolation) are real references. Without this guard the workspace
    // index happily returns any same-named symbol as a "definition".
    if (
      (document.languageId === 'kotlin' || document.languageId === 'java') &&
      isInsideCommentOrString(document.lineAt(position.line).text, wordRange.start.character)
    ) {
      const lineText = document.lineAt(position.line).text;
      const wordStart = wordRange.start.character;
      const isShortInterp = wordStart >= 1 && lineText[wordStart - 1] === '$';
      const isFullInterp  = isInsideStringInterpolation(lineText, wordStart);
      if (!isShortInterp && !isFullInterp) {
        this.log?.info(`provideDefinition: cursor in plain string/comment, not navigable`);
        return null;
      }
    }

    const log = (msg: string) => this.log?.info(`defn(${word}): ${msg}`);
    log(`file=${document.uri.path} line=${position.line} col=${position.character}`);

    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const testSegments = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);

    const currentIsTest = isTestPath(document.uri.path, testSegments);
    const allow = (path: string) => currentIsTest || !isTestPath(path, testSegments);

    // ── -2. Named-argument LHS resolution ────────────────────────────────────
    // `Foo(arg = value)` — the LHS `arg` is a Kotlin named argument and refers
    // to the parameter of the *called* function `Foo`, NOT to any binding in
    // the calling scope. Must run BEFORE local scope: if a local binding
    // happens to share the named argument's name (e.g.
    // `for (name in names) { Foo(name = name) }`), the LHS `name` would
    // otherwise resolve to the for-loop binding instead of `Foo.name`.
    // Cette etape doit OUVRIR le fichier candidat pour verifier qu'il porte
    // vraiment le parametre, donc elle est asynchrone. Le reste de la methode
    // le demeure : on ne rend une promesse que lorsque ce chemin s'applique
    // reellement, ce qui laisse la signature du provider inchangee et evite
    // d'imposer un `await` a chacun de ses appelants.
    if (estCandidatArgNomme(document, position, wordRange, word)) {
      return resolveNamedArgLhs(document, position, wordRange, word, this.index, allow)
        .then(loc => {
          if (loc) { log('step-2 named-arg LHS hit'); return loc; }
          return this.resoudreApresArgNomme(document, position, wordRange, word, log, allow);
        });
    }

    return this.resoudreApresArgNomme(document, position, wordRange, word, log, allow);
  }

  /** Toutes les etapes qui suivent celle des arguments nommes. Extraite pour
   *  que cette etape la puisse etre asynchrone sans contaminer le reste. */
  private resoudreApresArgNomme(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordRange: vscode.Range,
    word: string,
    log: (msg: string) => void,
    allow: (path: string) => boolean,
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {

    // ── -1. Local scope resolution (parameters + local val/var) ──────────────
    // Without this step, Cmd+Click on a parameter usage like `name` in
    // `Text(text = name)` falls through to the workspace index and returns
    // every top-level/class-level symbol named `name` — dozens of false
    // positives in any non-trivial codebase. The fix: when the cursor sits
    // inside a function, first try to resolve the word against that
    // function's own parameters and earlier locals. If found, that win
    // is unambiguous — a parameter shadows everything else by Kotlin's
    // scoping rules.
    const localLoc = resolveLocalScope(document, position, word);
    if (localLoc) {
      // Smart-nav: if the resolved location IS the cursor's exact word,
      // the user clicked on the DECLARATION itself (param, for-binding,
      // local val/var). VS Code's default behaviour would stay put — not
      // useful. Pivot to "go to usage(s)" instead, mirroring IntelliJ's
      // click-on-decl behaviour. Single usage → jump there; multiple →
      // VS Code shows a picker.
      const cursorOnDecl =
        localLoc.range.start.line      === position.line &&
        localLoc.range.start.character === wordRange.start.character;
      if (cursorOnDecl) {
        const usages = findLocalUsages(document, position, word);
        if (usages.length > 0) {
          log(`step-1 cursor on decl → ${usages.length} usage(s)`);
          return usages.length === 1 ? usages[0] : usages;
        }
      }
      log('step-1 local scope hit');
      return localLoc;
    }

    // ── 0. Qualified access: e.g. TypeA.VALUE or TypeB.VALUE ─────────────────
    const qualLocs = this.lookupQualified(word, wordRange, document, allow);
    log(`step0 qualLocs=${qualLocs.length} → ${qualLocs.map(l => l.uri.path).join(', ') || 'none'}`);
    if (qualLocs.length === 1) return qualLocs[0];
    if (qualLocs.length > 1)  return qualLocs;

    // ── 0b. Android resource reference: R.type.name ──────────────────────────
    // R.color.error, R.string.foo, etc. are resource IDs — not Kotlin symbols.
    // Without this guard the fallback simple-name lookup wrongly navigates to
    // an unrelated Kotlin property named "error", "warning", etc.
    const lineText = document.lineAt(position.line).text;
    if (isAndroidResourceRef(lineText, wordRange.start.character)) {
      log('step0b Android R.type.name pattern → null');
      return null;
    }

    // ── 1. Try FQN match via resolved imports (most precise) ─────────────────
    const resolved = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    const docUriStr = document.uri.toString();
    // Top-level `private` in Kotlin = file-private. Three top-level
    // `private fun foo` declarations across the workspace are unrelated
    // and must not cross-resolve. Class members (`depth > 0`) keep their
    // existing lenient behavior — the resolver can still navigate to a
    // private member in another file from within the same package
    // (matches the current test contract for `colorResource`).
    const isReachable = (e: { isPrivate?: boolean; depth?: number; uri: vscode.Uri }) =>
      !e.isPrivate || (e.depth ?? 0) > 0 || e.uri.toString() === docUriStr;
    const resolvedEntries = resolved.matches.filter(e => allow(e.uri.path) && isReachable(e));
    log(`step1 priority=${resolved.priority} resolvedEntries=${resolvedEntries.length} → ${resolvedEntries.map(e => e.fqn).join(', ') || 'none'}`);
    if (resolvedEntries.length > 0) {
      const declEntry = resolvedEntries.find(e => isAtDeclaration(e, document.uri, position));
      if (declEntry && resolvedEntries.length === 1) {
        // Override method/property → navigate to the interface/abstract declaration
        if (declEntry.isOverride && (declEntry.kind === 'fun' || declEntry.kind === 'composable'
            || declEntry.kind === 'val' || declEntry.kind === 'var')) {
          const superLoc = this.superMethodLocation(declEntry, allow);
          if (superLoc) return superLoc;
        }
        let impls = this.implLocations(word, allow, declEntry);
        if (impls.length === 0) impls = this.methodImplLocations(declEntry, allow);
        if (impls.length > 0) return impls;
        _pendingDeclNav = { uri: declEntry.uri.toString(), line: declEntry.line, word };
        return toLocation(declEntry);
      }

      if (resolvedEntries.length === 1) return withAliasTargets(resolvedEntries[0], this.index, allow);

      // ── 1a. Wildcard tiebreak: when multiple wildcard imports both hit the index,
      // prefer the symbol whose package shares the most components with the caller's
      // package. E.g. caller in com.example.ui → com.example.Button wins over
      // com.other.Button. Only applies when there is a unique winner.
      if (resolved.priority === 'wildcard') {
        // The `package <name>` declaration is always within the first
        // few lines — scan only those instead of allocating the full
        // document text. On a 5K-line file this drops ~50 KB allocs +
        // the regex walk per Cmd+Click.
        const filePackage = packageOfDocument(document);
        if (filePackage) {
          const winner = wildcardTiebreak(resolvedEntries, filePackage);
          if (winner) {
            log(`step1 wildcard tiebreak → ${winner.fqn}`);
            return withAliasTargets(winner, this.index, allow);
          }
        }
      }

      return resolvedEntries.map(toLocation);
    }

    // ── 2. Fallback: simple name lookup (same package or stdlib-like names) ──
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path) && isReachable(e));
    log(`step2 filtered=${filtered.length} → ${filtered.map(e => e.fqn).join(', ') || 'none'}`);
    if (filtered.length === 0) return this.onlineDocs(word, document, position, log);

    const declEntry = filtered.find(e => isAtDeclaration(e, document.uri, position));
    if (declEntry) {
      // Override method/property → navigate to the interface/abstract declaration
      if (declEntry.isOverride && (declEntry.kind === 'fun' || declEntry.kind === 'composable'
          || declEntry.kind === 'val' || declEntry.kind === 'var')) {
        const superLoc = this.superMethodLocation(declEntry, allow);
        if (superLoc) return superLoc;
      }
      let impls = this.implLocations(word, allow, declEntry);
      if (impls.length === 0) impls = this.methodImplLocations(declEntry, allow);
      if (impls.length > 0) return impls;
      _pendingDeclNav = { uri: declEntry.uri.toString(), line: declEntry.line, word };
      return toLocation(declEntry);
    }

    // ── 2a. Filter by import visibility ───────────────────────────────────────
    // A member belongs to an enclosing class (e.g. TypeA).
    // If that class is not imported (or same-package), the member should not
    // appear as a result — TypeB.VALUE must not show up when only
    // TypeA is imported.
    //
    // Priority chain: same-package + exact-imported beats wildcard. Default
    // wildcards (`java.lang.*`, `kotlin.collections.*`, etc.) would otherwise
    // surface noise like `java.lang.StackFrameInfo.type` for every `.type`
    // access, drowning out the real target. We only fall back to wildcards
    // when no near-by candidate exists.
    const classified = filtered
      .map(e => ({ entry: e, vis: enclosingVisibility(e, document) }))
      .filter(c => c.vis !== 'none');
    const near = classified.filter(c => c.vis === 'samePackage' || c.vis === 'exact');
    const wildcard = classified.filter(c => c.vis === 'wildcard');
    const visibleByImport = near.length > 0
      ? near.map(c => c.entry)
      : wildcard.map(c => c.entry);
    log(`step2 near=${near.length} wildcard=${wildcard.length} visibleByImport=${visibleByImport.length} → ${visibleByImport.map(e => e.fqn).join(', ') || 'none'}`);
    if (visibleByImport.length === 1) return withAliasTargets(visibleByImport[0], this.index, allow);
    if (visibleByImport.length > 1) {
      // Tiebreak: when the cursor is inside the file that declares one of the candidates
      // (e.g. NavigationViewModel.kt defines setFragment, and so does the delegate in the
      // same package), prefer the declaration in the current file over same-package siblings.
      const sameFile = visibleByImport.filter(e => e.uri.toString() === document.uri.toString());
      log(`step2 sameFileTiebreak=${sameFile.length} → ${sameFile.map(e => e.fqn).join(', ') || 'none'}`);
      if (sameFile.length === 1) return withAliasTargets(sameFile[0], this.index, allow);
      return visibleByImport.map(toLocation);
    }

    // ── 2b. Same-file fallback (self-references inside the declaring file) ────
    const sameFile = filtered.filter(e => e.uri.toString() === document.uri.toString());
    log(`step2 sameFile=${sameFile.length} → ${sameFile.map(e => e.fqn).join(', ') || 'none'}`);
    if (sameFile.length === 1) return withAliasTargets(sameFile[0], this.index, allow);

    // No evidence this file can reach any candidate: the enclosing class of every
    // found symbol is not imported, not in the same package, and the cursor is not
    // in the declaring file. The actual definition is likely in an unindexed library
    // (e.g. Compose's `colorResource` — imported but not indexed).
    if (visibleByImport.length === 0 && sameFile.length === 0) {
      log('step2 no visibility evidence → null');
      return this.onlineDocs(word, document, position, log);
    }

    log(`step2 ambiguous — returning all ${filtered.length} results`);
    return filtered.map(toLocation);
  }

  // Last resort behind kotlinJump.fallbackToOnlineDocs (off by default): a
  // Location on the virtual docs page, which opens the browser when followed.
  private onlineDocs(word: string, document: vscode.TextDocument, position: vscode.Position, log: (msg: string) => void): vscode.Location | null {
    const loc = onlineDocsLocation(word, document, position);
    if (loc) log(`online docs fallback → ${loc.uri.toString()}`);
    return loc;
  }

  // When cursor is on a member after '.', resolve the qualifier first, then
  // look up qualifier.member in the FQN index. This correctly disambiguates
  // members that share the same simple name across different classes without
  // requiring an explicit import for the member name itself.
  private lookupQualified(
    word: string,
    wordRange: vscode.Range,
    document: vscode.TextDocument,
    allow: (path: string) => boolean,
  ): vscode.Location[] {
    const col = wordRange.start.character;
    if (col < 2) return [];                    // need at least 'Q.'

    const line   = wordRange.start.line;
    const dotPos = new vscode.Position(line, col - 1);

    if (document.getText(new vscode.Range(dotPos, wordRange.start)) !== '.') return [];

    const qualRange = document.getWordRangeAtPosition(new vscode.Position(line, col - 2), WORD_RE);
    if (!qualRange) return [];

    const qualifier = document.getText(qualRange);
    const resolved = resolveBest(qualifier, document, qFqn => {
      const fqn = `${qFqn}.${word}`;
      const hit = this.index.lookupFqn(fqn);
      this.log?.info(`defn(${word}): lookupQualified qualifier="${qualifier}" fqn="${fqn}" → ${hit ? 'HIT ' + hit.fqn : 'miss'}`);
      return hit;
    });
    return resolved.matches.filter(e => allow(e.uri.path)).map(toLocation);
  }

  // `decl` is the declaration the cursor sits on, when there is one. Passing it
  // pins the answer to that exact type: by name alone, two `Callback`
  // interfaces sharing a package were merged, and the lens on that very line
  // announced a different number than this jump produced.
  //
  // It also settles what a name means. `bySuper` is keyed by supertype name,
  // so a `const val Handler` would otherwise answer with the classes that
  // extend android's `Handler`: a value is never implemented by anything.
  private implLocations(
    word: string,
    allow: (path: string) => boolean,
    decl?: { kind?: string; packageName?: string; fqn?: string },
  ): vscode.Location[] {
    if (decl && !CLASS_LIKE_KINDS.has(decl.kind ?? '')) return [];
    return this.index.implementationsOfName(word, decl?.packageName, decl?.fqn)
      .filter(e => allow(e.uri.path))
      .map(toLocation);
  }

  private methodImplLocations(
    entry: { name: string; uri: vscode.Uri; line: number; kind: string },
    allow: (path: string) => boolean,
  ): vscode.Location[] {
    if (entry.kind !== 'fun' && entry.kind !== 'composable') return [];
    return this.index.lookupMethodImplementations(entry.name, entry.uri.toString(), entry.line)
      .filter(e => allow(e.uri.path))
      .map(toLocation);
  }

  /**
   * For an override method, finds the corresponding declaration in the super
   * interface/class. Scans the enclosing class's supertypes and returns the
   * first matching non-override method found.
   */
  private superMethodLocation(
    entry: { name: string; uri: vscode.Uri; line: number },
    allow: (path: string) => boolean,
  ): vscode.Location | undefined {
    // Find the enclosing class and its supertypes
    const fileSymbols = this.index.getFileSymbols(entry.uri.toString());
    let enclosingSupertypes: readonly string[] | undefined;
    for (const s of fileSymbols) {
      if (s.line > entry.line) break;
      if (CLASS_LIKE_KINDS.has(s.kind)) enclosingSupertypes = s.supertypes;
    }
    if (!enclosingSupertypes || enclosingSupertypes.length === 0) return undefined;

    // For each supertype, look for a non-override method with the same name
    for (const supertype of enclosingSupertypes) {
      for (const supertypeEntry of this.index.lookup(supertype)) {
        if (!CLASS_LIKE_KINDS.has(supertypeEntry.kind)) continue;
        if (!allow(supertypeEntry.uri.path)) continue;
        const superSymbols = this.index.getFileSymbols(supertypeEntry.uri.toString());
        for (const s of superSymbols) {
          if (s.name === entry.name
              && (s.kind === 'fun' || s.kind === 'composable' || s.kind === 'val' || s.kind === 'var')
              && !s.isOverride) {
            return new vscode.Location(s.uri, new vscode.Position(s.line, s.character));
          }
        }
      }
    }
    return undefined;
  }
}

function isAtDeclaration(
  entry: { uri: vscode.Uri; line: number; character: number; name: string },
  docUri: vscode.Uri,
  position: vscode.Position,
): boolean {
  return entry.uri.toString() === docUri.toString()
    && entry.line === position.line
    && position.character >= entry.character
    && position.character < entry.character + entry.name.length;
}

// Returns true if the symbol's enclosing class is visible from the document
// (explicitly imported or in the same package). Used to filter out members
// of classes that aren't imported — e.g. TypeB.VALUE should not
// appear as a candidate when only TypeA is imported.
/** Priority of how the enclosing class of a candidate member becomes visible
 *  to the caller's document. Higher tiers beat lower ones in step 2 — when
 *  same-package and wildcard candidates both exist for the same simple name,
 *  the same-package one wins.
 *  - 'samePackage': enclosing class is a top-level symbol of `entry`.
 *  - 'exact':       enclosing class appears in an exact `import`.
 *  - 'wildcard':    enclosing class only reachable via a wildcard (incl. the
 *                   Kotlin compiler's default `java.lang.*`, `kotlin.collections.*`
 *                   etc.). This is the noisy tier that pulls in JDK/stdlib
 *                   members for any common name like `type`, `size`, `value`.
 *  - 'none':        enclosing class is not visible from this document. */
type EnclosingVisibility = 'samePackage' | 'exact' | 'wildcard' | 'none';

function enclosingVisibility(
  entry: { fqn: string; packageName?: string },
  document: vscode.TextDocument,
): EnclosingVisibility {
  const lastDot = entry.fqn.lastIndexOf('.');
  if (lastDot === -1) return 'samePackage'; // top-level symbol, treated as native to caller

  const parentFqn  = entry.fqn.slice(0, lastDot);
  const parentDot  = parentFqn.lastIndexOf('.');
  const parentName = parentDot === -1 ? parentFqn : parentFqn.slice(parentDot + 1);

  const result = resolveBest(parentName, document, fqn => fqn === parentFqn ? true : undefined);
  // resolveBest returns priority='none' iff matches is empty (ImportResolver.ts:91),
  // so we can pass the priority through directly.
  return result.priority;
}

function isEnclosingClassVisible(
  entry: { fqn: string; packageName?: string },
  document: vscode.TextDocument,
): boolean {
  return enclosingVisibility(entry, document) !== 'none';
}

function toLocation(e: { uri: vscode.Uri; line: number; character: number }): vscode.Location {
  return new vscode.Location(e.uri, new vscode.Position(e.line, e.character));
}

// When multiple wildcard-import candidates all exist in the index, prefer the
// one whose package shares the longest common prefix with the caller's package.
// E.g. caller in `com.example.ui`, candidates `com.example.Button` vs `com.other.Button`
// → `com.example.Button` wins (2 shared components vs 1).
// Returns undefined when scores are tied (genuine ambiguity → caller shows picker).
function wildcardTiebreak<T extends { fqn: string; packageName?: string }>(
  candidates: T[],
  filePackage: string,
): T | undefined {
  const fileParts = filePackage.split('.');
  let bestScore = -1;
  let bestCount = 0;
  let best: T | undefined;

  for (const c of candidates) {
    const pkg = c.packageName ?? c.fqn.slice(0, c.fqn.lastIndexOf('.'));
    const pkgParts = pkg.split('.');
    let score = 0;
    const len = Math.min(fileParts.length, pkgParts.length);
    while (score < len && fileParts[score] === pkgParts[score]) score++;

    if (score > bestScore) { bestScore = score; bestCount = 1; best = c; }
    else if (score === bestScore) { bestCount++; }
  }

  return bestCount === 1 ? best : undefined;
}

// Returns true when the word at `wordStart` is the name component of an Android
// resource reference `R.<type>.<name>` — e.g. R.color.error, R.string.app_name.
// In that case the name is a resource ID, not a Kotlin symbol, and simple-name
// fallback lookup would wrongly navigate to an unrelated property.
export function isAndroidResourceRef(line: string, wordStart: number): boolean {
  if (wordStart < 2 || line[wordStart - 1] !== '.') return false;
  // Walk back over the qualifier (e.g. "color")
  let j = wordStart - 2;
  while (j > 0 && /\w/.test(line[j - 1])) j--;
  if (j < 2 || line[j - 1] !== '.') return false;
  // Walk back over what precedes the qualifier's dot (must be exactly "R")
  let k = j - 2;
  while (k > 0 && /\w/.test(line[k - 1])) k--;
  return line.slice(k, j - 1) === 'R';
}

/**
 * Resolve a word in the local scope of the function/lambda enclosing
 * `position`. Returns a Location pointing at the parameter or local
 * `val`/`var` declaration, or `undefined` if the word isn't local.
 *
 * Algorithm:
 *  1. Walk backward from `position.line`, balancing braces, until we
 *     find a `fun NAME(` opener at depth 0 (the enclosing function),
 *     OR run past `MAX_SCAN_LINES` (cap blast radius on huge files).
 *  2. Inside the function body (between `{` and the cursor), match
 *     `val NAME` / `var NAME` declarations preceding the cursor.
 *  3. Inside the function header (the parenthesised parameter list),
 *     match `NAME: Type` patterns.
 *
 * The first hit wins. Parameter declarations always shadow same-name
 * locals declared LATER, so we return the local if the cursor is past
 * its declaration; otherwise the parameter.
 *
 * Skipped (out of scope, future work): nested lambda parameters with
 * `it`, destructuring `(a, b) ->`, `for (x in xs)` loop bindings,
 * `lambda.let { x -> }`. Those will fall through to the workspace
 * index and may still produce false positives — better than nothing,
 * worse than a real scope analyser.
 */
const SCOPE_CACHE_MAX = 8;
const scopeCache = new Map<string, { version: number; text: string; index: LocalScopeIndex }>();

export function cachedLocalScopeIndex(document: vscode.TextDocument): LocalScopeIndex {
  const key = `${document.languageId}:${document.uri.toString()}`;
  const text = document.getText();
  const hit = scopeCache.get(key);
  // The text is compared as well as the version: test doubles keep version 1
  // while their content changes, and a stale scope would resolve wrongly.
  if (hit && hit.version === document.version && hit.text === text) return hit.index;
  const index = buildLocalScopeIndex(text.split(/\r?\n/), document.languageId);
  scopeCache.delete(key); // re-insert at the end: a rewrite must not evict a neighbour
  if (scopeCache.size >= SCOPE_CACHE_MAX) scopeCache.delete(scopeCache.keys().next().value!);
  scopeCache.set(key, { version: document.version, text, index });
  return index;
}

export function resolveLocalScope(
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string,
  scope?: LocalScopeIndex,
): vscode.Location | undefined {
  if (document.languageId !== 'kotlin' && document.languageId !== 'java') return undefined;
  if (word.length < 2) return undefined;

  // Hot callers (semantic tokens, inlay hints) build the index once per run
  // and pass it; the other callers share a small per-document cache, since a
  // full pass per Go to Definition cost ten times the old backward walk.
  const index = scope ?? cachedLocalScopeIndex(document);
  if (position.line >= index.lines.length) return undefined;

  // Step 1 — the enclosing function, then the functions around it: inside
  // `new OnClickListener() { public void onClick(View v) { open(url); } }`
  // the `url` parameter of the outer method is captured, and `onClick`
  // alone knows nothing about it. Same for a Kotlin `object : Listener`.
  let funLine = index.enclosingFun[position.line];
  for (let hop = 0; funLine >= 0 && hop < 8; hop++) {
    const loc = resolveInFunction(document, index, funLine, position, word);
    if (loc) return loc;
    const outer = index.outerFun[funLine];
    if (outer === funLine) break;
    funLine = outer;
  }
  return undefined;
}

function resolveInFunction(
  document: vscode.TextDocument,
  index: LocalScopeIndex,
  funLine: number,
  position: vscode.Position,
  word: string,
): vscode.Location | undefined {
  const sigEndLine = Math.min(signatureEnd(index, funLine), position.line);
  const sigText = index.lines.slice(funLine, sigEndLine + 1).join('\n');

  // Step 2 — the latest local binding before the cursor. `character + 1`
  // keeps the binding that starts under the cursor: F2 on the first letter
  // of `val count` used to miss it and fall through to a workspace rename.
  const bestBinding = latestBinding(index, word, sigEndLine, position.line, position.character + 1);
  if (bestBinding) {
    return new vscode.Location(
      document.uri,
      new vscode.Range(
        new vscode.Position(bestBinding.line, bestBinding.col),
        new vscode.Position(bestBinding.line, bestBinding.col + word.length),
      ),
    );
  }

  // Step 3 — parameter names from the (possibly multi-line) signature.
  // Only consider names INSIDE the outermost parentheses of the function
  // signature: `fun foo(a: Int, b: String)`.
  const openIdx = sigText.indexOf('(');
  if (openIdx < 0) return undefined;
  const params  = sliceBalancedParens(sigText, openIdx);
  if (params === undefined) return undefined;
  // Param syntax: `[modifiers] NAME: TYPE [= default]`. Greedy match each
  // top-level `,`-separated chunk and pull the name from before the colon.
  if (document.languageId === 'java') {
    // Java: `[final] Type name`, the name is the last identifier of the chunk.
    // Without this, a Java parameter resolved to a same-named workspace
    // symbol, and F2 on it renamed the whole workspace.
    for (const chunk of splitTopLevel(params, ',')) {
      const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(chunk.replace(/@\w+(?:\([^)]*\))?/g, '').trim());
      if (!nameMatch || nameMatch[1] !== word) continue;
      const loc = findInDocumentLines(document, funLine, sigEndLine, name => name === word, /([A-Za-z_$][\w$]*)\s*(?=[,)])/g);
      if (loc) return loc;
    }
    return undefined;
  }
  for (const chunk of splitTopLevel(params, ',')) {
    const cleaned = chunk.replace(/\bvararg\s+|\bnoinline\s+|\bcrossinline\s+/g, '').trim();
    const nameMatch = /^(?:[A-Z][\w<>?,\s.]*\s+)?(\w+)\s*:/.exec(cleaned);
    if (!nameMatch || nameMatch[1] !== word) continue;
    // Find the absolute position of this name in funLineText / multi-line sig.
    const loc = findInDocumentLines(document, funLine, sigEndLine, name => name === word, /\b(\w+)\s*:/g);
    if (loc) return loc;
  }
  return undefined;
}

/**
 * Le curseur est il sur la partie GAUCHE d'un argument nomme ?
 *
 * Separe de la resolution parce que celle ci est asynchrone : le provider
 * ne doit payer une promesse que lorsque ce chemin s'applique vraiment.
 * Une seule implementation de la regle, donc pas de copie qui derive.
 */
function estCandidatArgNomme(
  document: vscode.TextDocument,
  position: vscode.Position,
  wordRange: vscode.Range,
  word: string,
): boolean {
  if (document.languageId !== 'kotlin' && document.languageId !== 'java') return false;
  if (word.length < 2) return false;
  const cursorLine = document.lineAt(position.line).text;
  const wordEnd    = wordRange.end.character;

  // Step 1 — confirm `word =` (single equals, not comparator/lambda).
  // Skip whitespace after the word; first non-space must be `=`, and
  // the char after that `=` must NOT make it a multi-char operator.
  let probe = wordEnd;
  while (probe < cursorLine.length && cursorLine[probe] === ' ') probe++;
  if (cursorLine[probe] !== '=') return false;
  const next = cursorLine[probe + 1];
  if (next === '=' || next === '>') return false; // ==, =>
  // The chars BEFORE the word should not be a comparator suffix:
  // `<=word`, `>=word`, `!=word`. The wordRange.start.character is
  // exactly where the word begins; check the two chars before.
  const wordStart = wordRange.start.character;
  if (wordStart >= 1 && cursorLine[wordStart - 1] === '=') {
    // word is just past `=` (impossible: there'd be no space and we'd
    // not be on word). But guard anyway.
    return false;
  }
  // Also ensure this is NOT a `val word =` / `var word =` declaration —
  // there it really IS just an assignment, not a named arg.
  const beforeWord = cursorLine.slice(0, wordStart);
  if (/\b(?:val|var)\s+$/.test(beforeWord)) return false;
  // Ni une ANNOTATION DE TYPE : `vm: Reglages = reglages()` est un parametre
  // a valeur par defaut, pas un argument nomme. Le mot suivi de `=` y est le
  // TYPE, et remonter jusqu'a la parenthese ouvrante renvoyait vers la
  // fonction englobante au lieu du type. Un argument nomme n'est jamais
  // precede de `:`, une annotation de type l'est toujours : c'est ce qui les
  // separe. Mesure sur un projet reel : 699 des 785 clics concernes, soit
  // 89 %, atterrissaient au mauvais endroit.
  // ATTENTION avant de retirer ceci : les tests de correction passent sans,
  // car la verification ajoutee en v1.42.148 ecarte desormais les candidates
  // qui n'ont pas le parametre, ce qui rattrape le symptome. Cette garde a
  // donc change de role : elle est devenue le chemin RAPIDE. Sans elle, tout
  // type de parametre par defaut entre dans la resolution asynchrone et fait
  // ouvrir des fichiers pour rien. Mesure sur un projet reel, 928 clics de
  // cette forme : 0 ouverture et 75,8 ms avec, 1388 ouvertures et 130,3 ms
  // sans, soit 42 % plus lent. `DefinitionDefaultParam` le verifie.
  if (/:\s*$/.test(beforeWord)) return false;

  return true;
}

/**
 * Resolve a word that sits on the LHS of a named argument
 * (`Foo(arg = value)`) to the `arg` parameter of `Foo`.
 *
 * Algorithm:
 *  1. Confirm the word is a named-arg LHS: it is followed by a single `=`
 *     (not `==`, `=>`, `>=`, `<=`, `!=`) and is preceded — somewhere
 *     above on the same line or on previous lines — by an open `(`
 *     whose matching `)` is past the cursor.
 *  2. Walk back from the LHS to find that open `(`, balancing nested
 *     `()` along the way. The token immediately before that `(` (skipping
 *     `Foo.bar`-style qualifier dots) is the called function's name.
 *  3. Resolve the called function:
 *     a. Local file: same `FUN_RE` scan as resolveLocalScope. Look for
 *        a fun with the matching simple name and pull its `(...)` block.
 *     b. Workspace index: `index.lookup(funName)` filtered to fun /
 *        composable kinds. For each candidate, read its source line
 *        and parse params.
 *  4. From the resolved function's parameter list, find the parameter
 *     with the matching name and return its location.
 *
 * Returns `undefined` if the cursor is not on a named-arg LHS or no
 * matching parameter is found — caller falls through to the next step.
 */
async function resolveNamedArgLhs(
  document: vscode.TextDocument,
  position: vscode.Position,
  wordRange: vscode.Range,
  word: string,
  index: SymbolIndex,
  allow: (path: string) => boolean,
): Promise<vscode.Definition | undefined> {
  if (!estCandidatArgNomme(document, position, wordRange, word)) return undefined;
  const wordStart = wordRange.start.character;

  // Step 2 — find the enclosing open `(` and the function name before it.
  // Walk back across the current line, then previous lines, balancing
  // `()` until we find a `(` at depth -1.
  const openLoc = findEnclosingOpenParen(document, position.line, wordStart);
  if (!openLoc) return undefined;

  const funName = extractFunctionNameBefore(document, openLoc.line, openLoc.col);
  if (!funName) return undefined;

  // Step 3a — same-file scan: look for `fun funName(...)` declaration.
  const sameFileLoc = resolveParamInLocalFunction(document, funName, word);
  if (sameFileLoc) return sameFileLoc;

  // Step 3b — workspace index lookup.
  const candidates = index.lookup(funName).filter(e =>
    (e.kind === 'fun' || e.kind === 'composable') && allow(e.uri.path),
  );
  if (candidates.length === 0) return undefined;

  // Ouvrir la candidate et y localiser le parametre pour de vrai. Sans cette
  // verification, toute fonction homonyme de l'espace de travail etait rendue
  // telle quelle : sur un projet reel, 266 des 651 clics concernes, soit
  // 41 %, ouvraient une fonction qui n'a PAS ce parametre. Etre envoye au
  // mauvais endroit est pire que de ne pas bouger.
  //
  // Le plafond borne la latence du Ctrl+clic : un nom tres courant peut avoir
  // des dizaines de candidates, et VS Code met les documents en cache, donc
  // le cout reel est d'une ou deux lectures.
  const locs: vscode.Location[] = [];
  for (const cand of candidates.slice(0, MAX_CANDIDATES_ARG_NOMME)) {
    let docCand: vscode.TextDocument | undefined;
    try { docCand = await vscode.workspace.openTextDocument(cand.uri); } catch { continue; }
    if (!docCand) continue;
    const loc = paramLocationInSignature(docCand, cand.line, word);
    if (loc) locs.push(loc);
  }
  if (locs.length === 0) return undefined;
  if (locs.length === 1) return locs[0];
  return locs;
}

/** Au dela, le Ctrl+clic couterait plus cher que ce qu'il rapporte. */
const MAX_CANDIDATES_ARG_NOMME = 12;

/** Find the open `(` that encloses the cursor, walking left across the
 *  current line and previous lines and balancing `()`. */
function findEnclosingOpenParen(
  document: vscode.TextDocument,
  startLine: number,
  startCol: number,
): { line: number; col: number } | undefined {
  let depth = 0;
  // Current line: walk from startCol-1 back to 0.
  const lineText = document.lineAt(startLine).text;
  for (let c = startCol - 1; c >= 0; c--) {
    const ch = lineText[c];
    if (ch === ')')      depth++;
    else if (ch === '(') {
      if (depth === 0) return { line: startLine, col: c };
      depth--;
    }
  }
  // Previous lines (cap at 50).
  const stop = Math.max(0, startLine - 50);
  for (let i = startLine - 1; i >= stop; i--) {
    const t = document.lineAt(i).text;
    for (let c = t.length - 1; c >= 0; c--) {
      const ch = t[c];
      if (ch === ')')      depth++;
      else if (ch === '(') {
        if (depth === 0) return { line: i, col: c };
        depth--;
      }
    }
  }
  return undefined;
}

/** The token immediately before `openCol` on `openLine`, skipping
 *  qualifier dots like `Foo.bar` so we return `bar`. */
function extractFunctionNameBefore(
  document: vscode.TextDocument,
  openLine: number,
  openCol: number,
): string | undefined {
  const text = document.lineAt(openLine).text;
  let end = openCol;
  // Skip whitespace between funName and `(` (rare but possible).
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  if (end === 0 || !/\w/.test(text[end - 1])) return undefined;
  let start = end;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  return text.slice(start, end);
}

/** Look for `fun funName(... param: T ...)` in `document` and return the
 *  location of `param`'s name in the signature. */
function resolveParamInLocalFunction(
  document: vscode.TextDocument,
  funName: string,
  paramName: string,
): vscode.Location | undefined {
  const NEEDLE = new RegExp(`\\bfun\\s+(?:<[^>]*>\\s*)?(?:[A-Z]\\w+\\s*\\.\\s*)?${funName}\\s*\\(`);
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    const m = NEEDLE.exec(text);
    if (!m) continue;
    return paramLocationInSignature(document, i, paramName);
  }
  return undefined;
}


/** Inside `document`, given the line with `fun funName(`, locate the
 *  parameter whose name matches `paramName`. Walks the (possibly
 *  multi-line) signature paren block. */
export function paramLocationInSignature(
  document: vscode.TextDocument,
  funLine: number,
  paramName: string,
): vscode.Location | undefined {
  // Reuse the multi-line signature collector logic.
  let sigText = document.lineAt(funLine).text;
  const lineOffsets: number[] = [0]; // char offset of each appended line in sigText
  let parenDepth = countChar(sigText, '(') - countChar(sigText, ')');
  let endLine    = funLine;
  for (let i = funLine + 1; parenDepth > 0 && i < document.lineCount; i++) {
    lineOffsets.push(sigText.length + 1);
    sigText += '\n' + document.lineAt(i).text;
    parenDepth += countChar(document.lineAt(i).text, '(') - countChar(document.lineAt(i).text, ')');
    endLine = i;
  }
  const openIdx = sigText.indexOf('(');
  if (openIdx < 0) return undefined;
  const params = sliceBalancedParens(sigText, openIdx);
  if (params === undefined) return undefined;

  // Walk each top-level chunk; pull the name; if it matches, find its
  // absolute position back in the document.
  let cursor = openIdx + 1; // position in sigText where the next chunk starts
  for (const chunk of splitTopLevel(params, ',')) {
    // Strip Kotlin parameter modifiers (`val`/`var` for data-class
    // primary constructors, plus inline modifiers) so the name regex
    // sees just `NAME: TYPE`.
    const cleaned = chunk.replace(
      /\b(?:vararg|noinline|crossinline|val|var|const\s+val|@\w+(?:\([^)]*\))?\s*)\s+/g,
      '',
    );
    const nameMatch = /^\s*(?:[A-Z][\w<>?,\s.]*\s+)?(\w+)\s*:/.exec(cleaned);
    if (nameMatch && nameMatch[1] === paramName) {
      // The match's name is `nameMatch[1]`; locate it in `chunk` to
      // compute its absolute offset in sigText.
      const localIdx = chunk.indexOf(nameMatch[1]);
      if (localIdx >= 0) {
        const absInSig = cursor + localIdx;
        // Convert sigText offset → document line+col.
        for (let i = lineOffsets.length - 1; i >= 0; i--) {
          if (lineOffsets[i] <= absInSig) {
            const col = absInSig - lineOffsets[i];
            const line = funLine + i;
            return new vscode.Location(
              document.uri,
              new vscode.Range(
                new vscode.Position(line, col),
                new vscode.Position(line, col + paramName.length),
              ),
            );
          }
        }
      }
    }
    cursor += chunk.length + 1; // +1 for the `,` consumed by splitTopLevel
  }
  void endLine; // silence unused
  return undefined;
}

/**
 * Find all in-file usages of `word` after the cursor's position,
 * excluding the binding occurrence itself. Used when the user clicks
 * on the declaration of a local symbol — instead of staying put on
 * the declaration, we navigate them to where the binding is consumed.
 *
 * Strategy:
 *  - Word-boundary regex match across each line from cursor to EOF.
 *  - Skip occurrences inside line comments (`//`) and string literals
 *    that are NOT inside `${ … }` interpolation. String content like
 *    `"name"` is text, not a code reference. But `"$name"` IS code.
 *  - Skip the cursor's own line if the match column equals the cursor's
 *    word start (that's the declaration).
 */
export function findLocalUsages(
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string,
): vscode.Location[] {
  const out: vscode.Location[] = [];
  const re = wordRegex(word);
  const declCol = document.getWordRangeAtPosition(position)?.start.character;
  // A local lives until the end of its function: the scan used to run to the
  // end of the file, so renaming the `user` of load() also rewrote
  // `show(user: User)` and `this.user` further down the class.
  const scope   = cachedLocalScopeIndex(document);
  const funLine = position.line < scope.enclosingFun.length ? scope.enclosingFun[position.line] : -1;
  const lastLine = funLine >= 0
    ? Math.min(document.lineCount - 1, functionBodyEndLine(scope, funLine))
    : Math.min(document.lineCount - 1, position.line + 1000);
  for (let i = position.line; i <= lastLine; i++) {
    const text = document.lineAt(i).text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // Skip the declaration itself.
      if (i === position.line && m.index === declCol) continue;
      // `this.user`, `other.user`, `::user`: a member access, never a local.
      if (m.index > 0 && (text[m.index - 1] === '.' || text[m.index - 1] === ':')) continue;
      // Skip comments and plain string content. Short-form
      // interpolation `$word` and full-form `${word}` are CODE and
      // must NOT be skipped — they are real usages of the binding.
      if (isInsideCommentOrString(text, m.index)) {
        const isShortInterp = m.index >= 1 && text[m.index - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(text, m.index);
        if (!isShortInterp && !isFullInterp) continue;
      }
      // Skip named-argument LHS — `Foo(word = …)`. The label refers to
      // the called function's parameter, not to this binding.
      if (looksLikeNamedArgLhs(document, i, m.index, word.length)) continue;
      out.push(new vscode.Location(
        document.uri,
        new vscode.Range(
          new vscode.Position(i, m.index),
          new vscode.Position(i, m.index + word.length),
        ),
      ));
    }
  }
  return out;
}

/**
 * Last line of the body of the function declared at `funLine`: the line of
 * the `}` matching its first `{`. A body without braces (`fun x(a: Int) =\n a + 1`)
 * ends before the next declaration line.
 */
function functionBodyEndLine(scope: LocalScopeIndex, funLine: number): number {
  const lines = scope.lines;
  const sigEnd = signatureEnd(scope, funLine);
  let depth = 0, opened = false;
  const stop = Math.min(lines.length - 1, funLine + 5000);
  for (let i = funLine; i <= stop; i++) {
    const t = lines[i];
    if (!opened && i > sigEnd && DECL_START_RE.test(t)) return i - 1;
    for (let c = 0; c < t.length; c++) {
      const ch = t[c];
      if (ch !== '{' && ch !== '}') continue;
      if (isInsideCommentOrString(t, c)) continue;
      if (ch === '{') { depth++; opened = true; }
      else if (opened && --depth === 0) return i;
    }
  }
  return stop;
}
const DECL_START_RE = /^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|protected|override|open|abstract|suspend|inline|infix|operator|tailrec|external|const|lateinit|data|sealed|inner|enum|annotation|final|value|companion|expect|actual)\s+)*(?:fun|val|var|class|object|interface|companion|init|constructor|typealias)\b/;

/** True when the word at (line, wordStart) is followed (after whitespace)
 *  by a single `=` AND the IMMEDIATELY enclosing opener to its left is an
 *  unmatched `(` (call args), not an unmatched `{` (lambda body):
 *
 *    Foo(name = x)              ← named-arg LHS, return true
 *    Foo { x -> name = x }      ← assignment in lambda, return false
 *    withContext(IO) { x = 5 }  ← assignment in lambda, return false
 *
 *  The walk continues on the previous lines (up to 50): ktlint puts one
 *  named argument per line, so `TopAppBar(\n title = { … },` is the
 *  common Compose shape, and its label was renamed with the parameter. */
function looksLikeNamedArgLhs(document: vscode.TextDocument, line: number, wordStart: number, wordLen: number): boolean {
  const text = document.lineAt(line).text;
  let probe = wordStart + wordLen;
  while (probe < text.length && text[probe] === ' ') probe++;
  if (text[probe] !== '=') return false;
  const next = text[probe + 1];
  if (next === '=' || next === '>') return false; // ==, =>
  // Walk back balancing BOTH parens and braces. Whichever opener we
  // encounter unmatched first decides the enclosing scope.
  let parenDepth = 0;
  let braceDepth = 0;
  const stopLine = Math.max(0, line - 50);
  for (let li = line; li >= stopLine; li--) {
    const t = li === line ? text : document.lineAt(li).text;
    for (let c = (li === line ? wordStart : t.length) - 1; c >= 0; c--) {
      const ch = t[c];
      if (ch === ')')      parenDepth++;
      else if (ch === '(') {
        if (parenDepth === 0) return true; // unmatched ( = call args
        parenDepth--;
      } else if (ch === '}') braceDepth++;
      else if (ch === '{') {
        if (braceDepth === 0) return false; // unmatched { = lambda body
        braceDepth--;
      }
    }
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/** Returns the substring inside a balanced `(...)` starting at `openIdx`,
 *  or `undefined` if the parens are unbalanced. */
function sliceBalancedParens(s: string, openIdx: number): string | undefined {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(')      depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return s.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

/** Split `s` on `sep` only at top level (depth 0 of `()` / `<>` / `[]`). */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '<' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** Walk lines [from..to] looking for `re` matches; first match satisfying
 *  `pred(name)` returns its document location. */
function findInDocumentLines(
  document: vscode.TextDocument,
  from: number,
  to: number,
  pred: (name: string) => boolean,
  re: RegExp,
): vscode.Location | undefined {
  for (let i = from; i <= to; i++) {
    const text = document.lineAt(i).text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (pred(m[1])) {
        return new vscode.Location(
          document.uri,
          new vscode.Range(new vscode.Position(i, m.index), new vscode.Position(i, m.index + m[1].length)),
        );
      }
    }
  }
  return undefined;
}

function withAliasTargets(
  entry: { uri: vscode.Uri; line: number; character: number; kind: string; aliasTarget?: string },
  index: import('../indexer/SymbolIndex').SymbolIndex,
  allow: (path: string) => boolean,
): vscode.Location | vscode.Location[] {
  if (entry.kind !== 'typealias' || !entry.aliasTarget) return toLocation(entry);

  const targetLocs: vscode.Location[] = [];
  ALIAS_TYPE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALIAS_TYPE_RE.exec(entry.aliasTarget)) !== null) {
    for (const hit of index.lookup(m[1])) {
      if (allow(hit.uri.path)) targetLocs.push(toLocation(hit));
    }
  }

  if (targetLocs.length === 0) return toLocation(entry);
  return [toLocation(entry), ...targetLocs];
}
