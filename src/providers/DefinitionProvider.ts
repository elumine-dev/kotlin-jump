import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

// Captures plain identifiers (not dotted — we handle dots manually below)
const WORD_RE = /[A-Za-z_]\w*/;

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
      if (entry && allow(entry.uri.path)) return toLocation(entry);
    }

    // ── 2. Fallback: simple name lookup (same package or stdlib-like names) ──
    const filtered = this.index.lookup(word).filter(e => allow(e.uri.path));
    if (filtered.length === 0) return null;
    if (filtered.length === 1) return toLocation(filtered[0]);

    // Multiple definitions — return all so VS Code shows the Peek list
    return filtered.map(toLocation);
  }
}

function toLocation(e: { uri: vscode.Uri; line: number; character: number }): vscode.Location {
  return new vscode.Location(e.uri, new vscode.Position(e.line, e.character));
}

// Detects test source roots by path segment — covers standard Gradle layouts
// for unit tests and instrumented tests.
function isTestPath(uriPath: string): boolean {
  return uriPath.includes('/test/') ||
         uriPath.includes('/androidTest/') ||
         uriPath.includes('/testDebug/') ||
         uriPath.includes('/testRelease/');
}
