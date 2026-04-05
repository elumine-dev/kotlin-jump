import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { Logger } from '../util/logger';

const WORD_RE = /[A-Za-z_]\w*/;
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;
const DEFAULT_TEST_SEGMENTS: string[] = [];

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

    // ── 0. Qualified access: e.g. TypeA.VALUE or TypeB.VALUE ─────────────────
    const qualLocs = this.lookupQualified(word, wordRange, document, allow);
    log(`step0 qualLocs=${qualLocs.length} → ${qualLocs.map(l => l.uri.path).join(', ') || 'none'}`);
    if (qualLocs.length === 1) return qualLocs[0];
    if (qualLocs.length > 1)  return qualLocs;

    // ── 1. Try FQN match via resolved imports (most precise) ─────────────────
    const resolved = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    const resolvedEntries = resolved.matches.filter(e => allow(e.uri.path));
    log(`step1 priority=${resolved.priority} resolvedEntries=${resolvedEntries.length} → ${resolvedEntries.map(e => e.fqn).join(', ') || 'none'}`);
    if (resolvedEntries.length > 0) {
      const declEntry = resolvedEntries.find(e => isAtDeclaration(e, document.uri, position));
      if (declEntry && resolvedEntries.length === 1) {
        let impls = this.implLocations(word, allow);
        if (impls.length === 0) impls = this.methodImplLocations(declEntry, allow);
        if (impls.length > 0) return impls;
        _pendingDeclNav = { uri: declEntry.uri.toString(), line: declEntry.line, word };
        return toLocation(declEntry);
      }

      if (resolvedEntries.length === 1) return withAliasTargets(resolvedEntries[0], this.index, allow);
      return resolvedEntries.map(toLocation);
    }

    // ── 2. Fallback: simple name lookup (same package or stdlib-like names) ──
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path));
    log(`step2 filtered=${filtered.length} → ${filtered.map(e => e.fqn).join(', ') || 'none'}`);
    if (filtered.length === 0) return null;

    const declEntry = filtered.find(e => isAtDeclaration(e, document.uri, position));
    if (declEntry) {
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
