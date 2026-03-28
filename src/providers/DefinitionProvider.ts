import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;
// Extracts all capitalised type names from an alias body like "List<KioskEdition>"
const ALIAS_TYPE_RE = /\b([A-Z]\w+)\b/g;

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

    // When navigating from main source, never resolve into test paths.
    // Prevents constructor parameter names matching mock fields in test files.
    const currentIsTest = isTestPath(document.uri.path);
    const allow = (path: string) => currentIsTest || !isTestPath(path);

    // ── 1. Try FQN match via resolved imports (most precise) ─────────────────
    const candidates = resolveImports(word, document);
    for (const fqn of candidates) {
      const entry = this.index.lookupFqn(fqn);
      if (entry && allow(entry.uri.path)) {
        // At declaration site — redirect to find usages
        if (isAtDeclaration(entry, document.uri, position)) {
          setTimeout(() => vscode.commands.executeCommand('editor.action.goToReferences'), 0);
          return null;
        }
        return withAliasTargets(entry, this.index, allow);
      }
    }

    // ── 2. Fallback: simple name lookup (same package or stdlib-like names) ──
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path));
    if (filtered.length === 0) return null;

    // At declaration site — redirect to find usages
    if (filtered.some(e => isAtDeclaration(e, document.uri, position))) {
      setTimeout(() => vscode.commands.executeCommand('editor.action.goToReferences'), 0);
      return null;
    }

    if (filtered.length === 1) return withAliasTargets(filtered[0], this.index, allow);

    // Multiple definitions — return all so VS Code shows the Peek list
    return filtered.map(toLocation);
  }
}

function isAtDeclaration(
  entry: { uri: vscode.Uri; line: number },
  docUri: vscode.Uri,
  position: vscode.Position,
): boolean {
  return entry.uri.toString() === docUri.toString() && entry.line === position.line;
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

// Detects test source roots by path segment — covers standard Gradle layouts
// for unit tests and instrumented tests.
function isTestPath(uriPath: string): boolean {
  return uriPath.includes('/test/') ||
         uriPath.includes('/androidTest/') ||
         uriPath.includes('/testDebug/') ||
         uriPath.includes('/testRelease/');
}
