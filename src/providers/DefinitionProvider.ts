import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { Logger } from '../util/logger';

const WORD_RE = /[A-Za-z_]\w*/;
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;
const RE_PKG = /^\s*package\s+([\w.]+)/m;
const DEFAULT_TEST_SEGMENTS: string[] = [];

const CLASS_LIKE_KINDS = new Set([
  'class', 'interface', 'object', 'enum', 'dataClass', 'sealedClass', 'annotation',
]);

// Shared state: set by provideDefinition, consumed by the selection listener in extension.ts
let _pendingDeclNav: { uri: string; line: number; word: string } | undefined;
export function getPendingDeclNav() { return _pendingDeclNav; }
export function clearPendingDeclNav() { _pendingDeclNav = undefined; }

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
    const namedArgLoc = resolveNamedArgLhs(document, position, wordRange, word, this.index, allow);
    if (namedArgLoc) { log('step-2 named-arg LHS hit'); return namedArgLoc; }

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
    const resolvedEntries = resolved.matches.filter(e => allow(e.uri.path));
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
        let impls = this.implLocations(word, allow);
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
        const filePackage = RE_PKG.exec(document.getText())?.[1] ?? '';
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
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path));
    log(`step2 filtered=${filtered.length} → ${filtered.map(e => e.fqn).join(', ') || 'none'}`);
    if (filtered.length === 0) return null;

    const declEntry = filtered.find(e => isAtDeclaration(e, document.uri, position));
    if (declEntry) {
      // Override method/property → navigate to the interface/abstract declaration
      if (declEntry.isOverride && (declEntry.kind === 'fun' || declEntry.kind === 'composable'
          || declEntry.kind === 'val' || declEntry.kind === 'var')) {
        const superLoc = this.superMethodLocation(declEntry, allow);
        if (superLoc) return superLoc;
      }
      let impls = this.implLocations(word, allow);
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
    const visibleByImport = filtered.filter(e => isEnclosingClassVisible(e, document));
    log(`step2 visibleByImport=${visibleByImport.length} → ${visibleByImport.map(e => e.fqn).join(', ') || 'none'}`);
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
      return null;
    }

    log(`step2 ambiguous — returning all ${filtered.length} results`);
    return filtered.map(toLocation);
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

  private implLocations(word: string, allow: (path: string) => boolean): vscode.Location[] {
    return this.index.lookupImplementations(word)
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

function isTestPath(uriPath: string, segments: string[]): boolean {
  return segments.some(s => uriPath.includes(s));
}

// Returns true if the symbol's enclosing class is visible from the document
// (explicitly imported or in the same package). Used to filter out members
// of classes that aren't imported — e.g. TypeB.VALUE should not
// appear as a candidate when only TypeA is imported.
function isEnclosingClassVisible(
  entry: { fqn: string; packageName?: string },
  document: vscode.TextDocument,
): boolean {
  const lastDot = entry.fqn.lastIndexOf('.');
  if (lastDot === -1) return true; // top-level symbol, always visible

  const parentFqn  = entry.fqn.slice(0, lastDot);
  const parentDot  = parentFqn.lastIndexOf('.');
  const parentName = parentDot === -1 ? parentFqn : parentFqn.slice(parentDot + 1);

  const result = resolveBest(parentName, document, fqn => fqn === parentFqn ? true : undefined);
  return result.matches.length > 0;
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
function resolveLocalScope(
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string,
): vscode.Location | undefined {
  if (document.languageId !== 'kotlin' && document.languageId !== 'java') return undefined;
  if (word.length < 2) return undefined;

  const MAX_SCAN_LINES = 5000;

  // Permissive `fun NAME(` matcher: `[^(]*?` non-greedily skips the
  // generic-parameter list (with arbitrarily nested `<>`), the
  // optional receiver (`String.`), and any other signature noise
  // until the actual identifier right before `(`.
  const FUN_RE = /\bfun\b[^(]*?\b(\w+)\s*\(/;

  // Step 1 — find the line that opens the enclosing function. Walk
  // backward balancing `{`/`}`. Every time we cross an opening brace
  // (depth would go negative) we have found AN enclosing scope, but
  // it may be a sibling block (`for { … }`, `Column { … }`, lambda
  // body) rather than the function itself. So we record the crossing
  // line, RESET the balance, and keep walking until we find a line
  // that actually declares a function.
  const start = Math.max(0, position.line - MAX_SCAN_LINES);
  let braceDepth = 0;
  let funLine = -1;
  let funLineText = '';

  // Single-expression body fast path: `fun NAME(...): T = expr` has no
  // body braces, so the brace-balance walker will never trigger. If
  // the cursor's own line declares a function, that's the enclosing
  // function — no walking needed.
  const cursorLineText = document.lineAt(position.line).text;
  if (FUN_RE.test(cursorLineText)) {
    funLine = position.line;
    funLineText = cursorLineText;
  } else {
    for (let i = position.line; i >= start; i--) {
      const text = document.lineAt(i).text;
      // Balance from RIGHT to LEFT.
      for (let c = text.length - 1; c >= 0; c--) {
        const ch = text[c];
        if (ch === '}')      braceDepth++;
        else if (ch === '{') braceDepth--;
      }
      if (braceDepth < 0) {
        // Crossed a `{`. Walk up looking for `fun NAME(` — handles
        // multi-line signatures by continuing past param-decl lines.
        // Stops if we cross a `}` (sibling function close above).
        let probe = i;
        while (probe >= start) {
          const probeText = document.lineAt(probe).text;
          if (FUN_RE.test(probeText)) {
            funLine = probe;
            funLineText = probeText;
            break;
          }
          // Tolerate `}` on the FIRST iteration (the `{` line itself
          // may have a sibling `}` like `} else {`). Bail on later
          // iterations — we'd be entering a previous function.
          if (probe < i && probeText.includes('}')) break;
          probe--;
        }
        if (funLine >= 0) break;
        braceDepth = 0;
      }
    }
  }
  if (funLine < 0) return undefined;

  // Collect signature text across continuation lines until balanced `(...)`.
  let sigText = funLineText;
  let parenDepth = countChar(sigText, '(') - countChar(sigText, ')');
  let sigEndLine = funLine;
  for (let i = funLine + 1; parenDepth > 0 && i <= position.line && i < document.lineCount; i++) {
    const t = document.lineAt(i).text;
    sigText += '\n' + t;
    parenDepth += countChar(t, '(') - countChar(t, ')');
    sigEndLine = i;
  }

  // Step 2 — bindings between sigEndLine and the cursor: local val/var,
  // for-loop bindings (`for (x in xs)`), and lambda parameters
  // (`{ x ->` / `{ x, y ->`). Walk forward; the LATEST binding before
  // the cursor wins because it shadows any earlier same-name binding.
  // We over-approximate scope (a `for` body is treated as in-scope
  // until end-of-function rather than end-of-loop) — cheap, correct in
  // practice for typical code, and never returns a false positive
  // outside the enclosing function.
  type Binding = { line: number; col: number };
  let bestBinding: Binding | undefined;
  const recordIfMatch = (i: number, t: string, name: string, nameStart: number): void => {
    if (name !== word) return;
    if (i === position.line && nameStart >= position.character) return; // cursor not after this binding
    bestBinding = { line: i, col: nameStart };
  };

  const VAL_VAR_RE = /\b(?:val|var)\s+(\w+)\b/g;
  // `for (x in xs)` and `for ((a, b) in xs)`. Also catches `for (x: T in xs)`.
  const FOR_RE     = /\bfor\s*\(\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+))(?:\s*:\s*[\w<>?,\s.]+)?\s+in\b/g;
  // Lambda params: `{ x ->`, `{ x, y ->`, `{ (a, b) ->`. Inline string
  // matchers — we don't try to handle `it` since it's keyword-magic.
  const LAMBDA_RE  = /\{\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+)(?:\s*,\s*\w+)*)\s*->/g;

  for (let i = sigEndLine; i <= position.line && i < document.lineCount; i++) {
    const t = document.lineAt(i).text;
    VAL_VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAL_VAR_RE.exec(t))) {
      recordIfMatch(i, t, m[1], m.index + m[0].indexOf(m[1]));
    }
    FOR_RE.lastIndex = 0;
    while ((m = FOR_RE.exec(t))) {
      // Group 1+2 = destructuring; group 3 = single var.
      const candidates = m[3] ? [m[3]] : [m[1], m[2]];
      for (const name of candidates) {
        const nameIdx = t.indexOf(name, m.index);
        if (nameIdx >= 0) recordIfMatch(i, t, name, nameIdx);
      }
    }
    LAMBDA_RE.lastIndex = 0;
    while ((m = LAMBDA_RE.exec(t))) {
      const candidates = m[3] ? splitTopLevel(m[0].slice(1, m[0].indexOf('->')), ',').map(s => s.trim()) : [m[1], m[2]];
      for (const raw of candidates) {
        const name = raw.replace(/[()\s]/g, '');
        const nameIdx = t.indexOf(name, m.index);
        if (nameIdx >= 0) recordIfMatch(i, t, name, nameIdx);
      }
    }
  }
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
function resolveNamedArgLhs(
  document: vscode.TextDocument,
  position: vscode.Position,
  wordRange: vscode.Range,
  word: string,
  index: SymbolIndex,
  allow: (path: string) => boolean,
): vscode.Definition | undefined {
  if (document.languageId !== 'kotlin' && document.languageId !== 'java') return undefined;
  if (word.length < 2) return undefined;

  const cursorLine = document.lineAt(position.line).text;
  const wordEnd    = wordRange.end.character;

  // Step 1 — confirm `word =` (single equals, not comparator/lambda).
  // Skip whitespace after the word; first non-space must be `=`, and
  // the char after that `=` must NOT make it a multi-char operator.
  let probe = wordEnd;
  while (probe < cursorLine.length && cursorLine[probe] === ' ') probe++;
  if (cursorLine[probe] !== '=') return undefined;
  const next = cursorLine[probe + 1];
  if (next === '=' || next === '>') return undefined; // ==, =>
  // The chars BEFORE the word should not be a comparator suffix:
  // `<=word`, `>=word`, `!=word`. The wordRange.start.character is
  // exactly where the word begins; check the two chars before.
  const wordStart = wordRange.start.character;
  if (wordStart >= 1 && cursorLine[wordStart - 1] === '=') {
    // word is just past `=` (impossible: there'd be no space and we'd
    // not be on word). But guard anyway.
    return undefined;
  }
  // Also ensure this is NOT a `val word =` / `var word =` declaration —
  // there it really IS just an assignment, not a named arg.
  const beforeWord = cursorLine.slice(0, wordStart);
  if (/\b(?:val|var)\s+$/.test(beforeWord)) return undefined;

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

  const locs: vscode.Location[] = [];
  for (const cand of candidates) {
    const loc = resolveParamInIndexedFunction(cand, word);
    if (loc) locs.push(loc);
  }
  if (locs.length === 0) return undefined;
  if (locs.length === 1) return locs[0];
  return locs;
}

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

/** Resolve param via an index entry (fun/composable in another file). */
function resolveParamInIndexedFunction(
  entry: { uri: vscode.Uri; line: number },
  paramName: string,
): vscode.Location | undefined {
  // We don't have an in-memory text document here. Reading the file
  // synchronously would block; defer this branch to a no-op for
  // simplicity in the MVP. Callers that need cross-file param
  // resolution can be served by the index entry's line range — VS
  // Code's "Go to Definition" picker will land the user on the
  // function declaration line, which is a strict improvement over
  // the previous "no result" behaviour.
  return new vscode.Location(
    entry.uri,
    new vscode.Range(new vscode.Position(entry.line, 0), new vscode.Position(entry.line, 0)),
  );
}

/** Inside `document`, given the line with `fun funName(`, locate the
 *  parameter whose name matches `paramName`. Walks the (possibly
 *  multi-line) signature paren block. */
function paramLocationInSignature(
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
    const cleaned = chunk.replace(/\bvararg\s+|\bnoinline\s+|\bcrossinline\s+/g, '');
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
function findLocalUsages(
  document: vscode.TextDocument,
  position: vscode.Position,
  word: string,
): vscode.Location[] {
  const out: vscode.Location[] = [];
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const declCol = document.getWordRangeAtPosition(position)?.start.character;
  const lastLine = Math.min(document.lineCount - 1, position.line + 1000);
  for (let i = position.line; i <= lastLine; i++) {
    const text = document.lineAt(i).text;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // Skip the declaration itself.
      if (i === position.line && m.index === declCol) continue;
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
      if (looksLikeNamedArgLhs(text, m.index, word.length)) continue;
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

/** True when `text[wordStart..wordStart+wordLen]` is followed (after
 *  whitespace) by a single `=` AND the IMMEDIATELY enclosing opener
 *  to its left is an unmatched `(` (call args), not an unmatched `{`
 *  (lambda body). Distinguishes:
 *
 *    Foo(name = x)              ← named-arg LHS, return true
 *    Foo { x -> name = x }      ← assignment in lambda, return false
 *    withContext(IO) { x = 5 }  ← assignment in lambda, return false
 *
 *  Single-line heuristic — multi-line named-args that span lines
 *  fall through to "not a named-arg" silently. Acceptable: smart-nav
 *  may then surface the LHS as an extra usage in the picker, which is
 *  noise, not a wrong jump. */
function looksLikeNamedArgLhs(text: string, wordStart: number, wordLen: number): boolean {
  let probe = wordStart + wordLen;
  while (probe < text.length && text[probe] === ' ') probe++;
  if (text[probe] !== '=') return false;
  const next = text[probe + 1];
  if (next === '=' || next === '>') return false; // ==, =>
  // Walk back balancing BOTH parens and braces. Whichever opener we
  // encounter unmatched first decides the enclosing scope.
  let parenDepth = 0;
  let braceDepth = 0;
  for (let c = wordStart - 1; c >= 0; c--) {
    const ch = text[c];
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
