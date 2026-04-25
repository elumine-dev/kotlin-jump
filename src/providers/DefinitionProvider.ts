import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
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
    if (localLoc) { log('step-1 local scope hit'); return localLoc; }

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

  const MAX_SCAN_LINES = 400;

  // Step 1 — find the line that opens the enclosing function. We walk
  // backwards balancing `{`/`}` so a sibling block above doesn't trick
  // us into picking the wrong function.
  const start = Math.max(0, position.line - MAX_SCAN_LINES);
  let braceDepth = 0;
  let funLine = -1;
  let funLineText = '';
  for (let i = position.line; i >= start; i--) {
    const text = document.lineAt(i).text;
    // Balance from RIGHT to LEFT so we don't double-count line we're on.
    for (let c = text.length - 1; c >= 0; c--) {
      const ch = text[c];
      if (ch === '}')      braceDepth++;
      else if (ch === '{') braceDepth--;
    }
    if (braceDepth < 0) {
      // We crossed an opening `{` that has no matching close before
      // the cursor — this is the body opener of the enclosing fun.
      // Look for `fun NAME(` on this line OR a line above (multi-line
      // signatures). Walk up while still seeing `(` /  signature
      // continuation.
      let probe = i;
      while (probe >= start) {
        const probeText = document.lineAt(probe).text;
        const m = /\bfun\s+(?:<[^>]*>\s*)?(?:[A-Z]\w+\s*\.\s*)?(\w+)\s*\(/.exec(probeText);
        if (m) { funLine = probe; funLineText = probeText; break; }
        // Multi-line signature opener: this line has `(` but no `fun` —
        // continue backwards.
        if (!probeText.includes('(')) break;
        probe--;
      }
      break;
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

  // Step 2 — local val/var declarations between sigEndLine+1 and the cursor.
  // Walk forward; first match BEFORE the cursor wins.
  const declRe = /\b(?:val|var)\s+(\w+)\b/g;
  for (let i = sigEndLine; i <= position.line && i < document.lineCount; i++) {
    const t = document.lineAt(i).text;
    declRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(t))) {
      // Skip the cursor's own line if the declaration is AT or AFTER the cursor column.
      if (i === position.line && m.index >= position.character) break;
      if (m[1] === word) {
        const col = m.index + m[0].indexOf(word);
        return new vscode.Location(
          document.uri,
          new vscode.Range(new vscode.Position(i, col), new vscode.Position(i, col + word.length)),
        );
      }
    }
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
