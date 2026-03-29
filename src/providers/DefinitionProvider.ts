import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;
// Extracts all capitalised type names from an alias body like "List<UserProfile>"
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;

// Fallback used when kotlinNav.testSourceSets is not configured.
// Covers standard Gradle source set layouts for unit tests and instrumented tests.
const DEFAULT_TEST_SEGMENTS: string[] = [];

export class KotlinDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    const cfg = vscode.workspace.getConfiguration('kotlinNav');
    const testSegments = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
    const smartNav     = cfg.get<boolean>('smartNavigation', true);
    // true  → custom Find Usages panel (with filter buttons)
    // false → built-in References panel (editor.action.goToReferences)
    const usagesCmd = smartNav ? 'kotlin-nav.findUsages' : 'editor.action.goToReferences';

    // When navigating from main source, never resolve into test paths.
    // Prevents constructor parameter names matching mock fields in test files.
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
          const excl = { excludeUri: entry.uri.toString(), excludeLine: entry.line };
          setTimeout(() => vscode.commands.executeCommand('kotlin-nav.findUsages', excl), 0);
          return null;
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
      const excl = { excludeUri: declEntry.uri.toString(), excludeLine: declEntry.line };
      setTimeout(() => vscode.commands.executeCommand('kotlin-nav.findUsages', excl), 0);
      return null;
    }

    if (filtered.length === 1) return withAliasTargets(filtered[0], this.index, allow);

    // Multiple definitions — return all so VS Code shows the Peek list
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
  entry: { uri: vscode.Uri; line: number },
  docUri: vscode.Uri,
  position: vscode.Position,
): boolean {
  return entry.uri.toString() === docUri.toString() && entry.line === position.line;
}

function isTestPath(uriPath: string, segments: string[]): boolean {
  return segments.some(s => uriPath.includes(s));
}

function toLocation(e: { uri: vscode.Uri; line: number; character: number }): vscode.Location {
  return new vscode.Location(e.uri, new vscode.Position(e.line, e.character));
}

// For a typealias, returns the declaration + all resolved alias-target locations.
// For any other kind, returns just the declaration location.
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
