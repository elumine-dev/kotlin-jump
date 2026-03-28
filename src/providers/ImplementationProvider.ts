import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;

export class KotlinImplementationProvider implements vscode.ImplementationProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideImplementation(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    const impls = this.index.lookupImplementations(word);
    if (impls.length === 0) return null;

    return impls.map(e => new vscode.Location(e.uri, new vscode.Position(e.line, e.character)));
  }
}
