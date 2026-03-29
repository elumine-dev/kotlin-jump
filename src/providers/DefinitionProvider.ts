import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;
const DEFAULT_TEST_SEGMENTS: string[] = [];

// Shared state: set by provideDefinition, consumed by the selection listener in extension.ts
let _pendingDeclNav: { uri: string; line: number; word: string } | undefined;
export function getPendingDeclNav() { return _pendingDeclNav; }
export function clearPendingDeclNav() { _pendingDeclNav = undefined; }

export class KotlinDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    _pendingDeclNav = undefined; // clear stale state from previous hover/click
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const testSegments = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);

    const currentIsTest = isTestPath(document.uri.path, testSegments);
    const allow = (path: string) => currentIsTest || !isTestPath(path, testSegments);

    // ── 1. Try FQN match via resolved imports (most precise) ─────────────────
    const candidates = resolveImports(word, document);
    for (const fqn of candidates) {
      const entry = this.index.lookupFqn(fqn);
      if (entry && allow(entry.uri.path)) {
        if (isAtDeclaration(entry, document.uri, position)) {
          let impls = this.implLocations(word, allow);
          if (impls.length === 0) impls = this.methodImplLocations(entry, allow);
          if (impls.length > 0) return impls;
          // Mark for the selection listener — will fire Find Usages on actual click
          _pendingDeclNav = { uri: entry.uri.toString(), line: entry.line, word };
          return toLocation(entry);
        }
        return withAliasTargets(entry, this.index, allow);
      }
    }

    // ── 2. Fallback: simple name lookup (same package or stdlib-like names) ──
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path));
    if (filtered.length === 0) return null;

    const declEntry = filtered.find(e => isAtDeclaration(e, document.uri, position));
    if (declEntry) {
      let impls = this.implLocations(word, allow);
      if (impls.length === 0) impls = this.methodImplLocations(declEntry, allow);
      if (impls.length > 0) return impls;
      _pendingDeclNav = { uri: declEntry.uri.toString(), line: declEntry.line, word };
      return toLocation(declEntry);
    }

    if (filtered.length === 1) return withAliasTargets(filtered[0], this.index, allow);
    return filtered.map(toLocation);
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
