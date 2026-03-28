import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { SymbolKind as KtKind } from '../indexer/KotlinParser';

const KIND: Record<KtKind, vscode.SymbolKind> = {
  class:       vscode.SymbolKind.Class,
  interface:   vscode.SymbolKind.Interface,
  object:      vscode.SymbolKind.Module,
  enum:        vscode.SymbolKind.Enum,
  dataClass:   vscode.SymbolKind.Struct,
  sealedClass: vscode.SymbolKind.Class,
  annotation:  vscode.SymbolKind.Interface,
  fun:         vscode.SymbolKind.Function,
  composable:  vscode.SymbolKind.Function,
  val:         vscode.SymbolKind.Constant,
  var:         vscode.SymbolKind.Variable,
  typealias:   vscode.SymbolKind.TypeParameter,
};

export class KotlinFileProvider implements vscode.WorkspaceSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideWorkspaceSymbols(query: string): vscode.ProviderResult<vscode.SymbolInformation[]> {
    if (!query) return [];
    return this.index.search(query).map(e =>
      new vscode.SymbolInformation(
        e.name,
        KIND[e.kind] ?? vscode.SymbolKind.Variable,
        e.moduleName ?? e.packageName,
        new vscode.Location(e.uri, new vscode.Position(e.line, e.character)),
      )
    );
  }
}
