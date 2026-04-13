import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';

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

    // 1. Class/interface implementations (e.g. cursor on "PokemonRepository")
    const classImpls = this.index.lookupImplementations(word);
    if (classImpls.length > 0) {
      return classImpls.map(e => new vscode.Location(e.uri, new vscode.Position(e.line, e.character)));
    }

    // 2. Method implementations — cursor on the declaration line
    const allMethods = this.index.lookup(word).filter(e =>
      e.kind === 'fun' || e.kind === 'composable',
    );

    const declEntry = allMethods.find(e =>
      e.uri.toString() === document.uri.toString() &&
      e.line === position.line,
    );
    if (declEntry) {
      const methodImpls = this.index.lookupMethodImplementations(
        declEntry.name, declEntry.uri.toString(), declEntry.line,
      );
      return methodImpls.length > 0
        ? methodImpls.map(e => new vscode.Location(e.uri, new vscode.Position(e.line, e.character)))
        : null;
    }

    // 3. Call site — find non-override declarations of this method and return their impls
    const abstractDecls = allMethods.filter(e => !e.isOverride);
    if (abstractDecls.length === 0) return null;

    const results: vscode.Location[] = [];
    for (const decl of abstractDecls) {
      const impls = this.index.lookupMethodImplementations(decl.name, decl.uri.toString(), decl.line);
      for (const impl of impls) {
        results.push(new vscode.Location(impl.uri, new vscode.Position(impl.line, impl.character)));
      }
    }
    return results.length > 0 ? results : null;
  }
}
