import * as vscode from 'vscode';
import picomatch from 'picomatch';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { scanForUsages } from './FindUsagesEngine';

const WORD_RE = /[A-Za-z_]\w*/;

// ── Picomatch cache ───────────────────────────────────────────────────────────
// Patterns compiled once, invalidated when config changes (key = patterns joined by \0).
let _matcherKey = '';
let _matchers: ((path: string) => boolean)[] = [];

function getExcludeMatchers(): ((path: string) => boolean)[] {
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

function isExcluded(uriString: string): boolean {
  const matchers = getExcludeMatchers();
  if (matchers.length === 0) return false;
  return matchers.some(m => m(vscode.Uri.parse(uriString).path));
}

export class KotlinReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    if (this.index.lookup(word).length === 0) return null;

    // Pre-filter URI list before any I/O (pure CPU — picomatch pre-compiled)
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));

    const raw = await scanForUsages(word, document, this.index, uriStrings, token);
    if (raw.length === 0) return null;

    // Optionally exclude declaration sites
    const decls = this.index.lookup(word);
    const declKeys = new Set(decls.map(e => `${e.uri.toString()}:${e.line}:${e.character}`));

    const locations = raw
      .filter(r => context.includeDeclaration || !declKeys.has(`${r.uriString}:${r.line}:${r.character}`))
      .map(r => new vscode.Location(r.uri, new vscode.Position(r.line, r.character)));

    return locations.length > 0 ? locations : null;
  }
}
