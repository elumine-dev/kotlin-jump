import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
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

// ── Kind filter syntax: @tag[:name]  e.g. "@class:user", "@fun:connect", "@enum:" ──
//
// Supported tags:
//   @class      class / data class / sealed class / annotation class
//   @interface  interface
//   @object     object singleton
//   @enum       enum class
//   @fun        fun / @Composable fun
//   @compose    @Composable fun only
//   @val        val / const val
//   @var        var
//   @type       all class-like + typealias (broad "what is a type")
//   @typealias  typealias only
const KIND_FILTER: Record<string, KtKind[]> = {
  class:      ['class', 'dataClass', 'sealedClass', 'annotation'],
  interface:  ['interface'],
  object:     ['object'],
  enum:       ['enum'],
  fun:        ['fun', 'composable'],
  compose:    ['composable'],
  val:        ['val'],
  var:        ['var'],
  type:       ['class', 'dataClass', 'sealedClass', 'annotation', 'interface', 'typealias'],
  typealias:  ['typealias'],
};

// Parses "@tag" or "@tag:name" — colon and name are optional.
// Returns null kinds when the tag is unrecognised (falls back to normal search).
function parseQuery(raw: string): { kinds: Set<KtKind> | null; name: string } {
  const m = /^@(\w+)(?::(.*))?$/.exec(raw.trim());
  if (m) {
    const tag   = m[1].toLowerCase();
    const kinds = KIND_FILTER[tag];
    if (kinds) return { kinds: new Set(kinds), name: (m[2] ?? '').trim() };
  }
  return { kinds: null, name: raw };
}

export class KotlinFileProvider implements vscode.WorkspaceSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideWorkspaceSymbols(query: string): vscode.ProviderResult<vscode.SymbolInformation[]> {
    if (!query) return [];

    const { kinds, name } = parseQuery(query);

    let entries: SymbolEntry[];
    if (kinds && !name) {
      // "@class:" with no name → list all symbols of that kind
      entries = this.index.filterByKind(kinds);
    } else {
      entries = this.index.search(name);
      if (kinds) entries = entries.filter(e => kinds.has(e.kind));
    }

    return entries.map(e =>
      new vscode.SymbolInformation(
        e.name,
        KIND[e.kind] ?? vscode.SymbolKind.Variable,
        e.moduleName ?? e.packageName,
        new vscode.Location(e.uri, new vscode.Position(e.line, e.character)),
      )
    );
  }
}
