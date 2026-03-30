import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { scanForUsages, isExcluded } from './FindUsagesEngine';

const WORD_RE = /[A-Za-z_]\w*/;

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
