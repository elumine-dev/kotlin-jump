import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';

const WORD_RE = /[A-Za-z_]\w*/;

const CLASS_LIKE = new Set<SymbolKind>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

const KIND_LABEL: Record<string, string> = {
  class: 'class',
  interface: 'interface',
  object: 'object',
  enum: 'enum',
  dataClass: 'data class',
  sealedClass: 'sealed',
  annotation: 'annotation',
};

// Sort order: interfaces → abstract/sealed → concrete → data → object → enum
const KIND_ORDER: Record<string, number> = {
  interface: 0,
  sealedClass: 1,
  annotation: 2,
  class: 3,
  dataClass: 4,
  object: 5,
  enum: 6,
};

function toSymbolKind(kind: SymbolKind): vscode.SymbolKind {
  switch (kind) {
    case 'interface':   return vscode.SymbolKind.Interface;
    case 'enum':        return vscode.SymbolKind.Enum;
    case 'object':      return vscode.SymbolKind.Object;
    case 'dataClass':
    case 'sealedClass':
    case 'annotation':
    case 'class':
    default:            return vscode.SymbolKind.Class;
  }
}

function fileName(uri: { toString(): string }): string {
  const path = uri.toString();
  return path.split('/').pop() ?? path;
}

function buildDetail(entry: SymbolEntry, index: SymbolIndex, parentEntry?: SymbolEntry): string {
  const kindLabel = KIND_LABEL[entry.kind] ?? entry.kind;
  const parts: string[] = [kindLabel];

  // File name
  parts.push(fileName(entry.uri));

  // Package
  if (entry.packageName) parts.push(entry.packageName);

  // Subtype count
  const subtypeCount = index.lookupImplementations(entry.name).length;

  // Sealed class exhaustive indicator
  if (entry.kind === 'sealedClass' && subtypeCount > 0) {
    parts.push(`${subtypeCount}/${subtypeCount} exhaustive`);
  } else if (subtypeCount > 0) {
    parts.push(`${subtypeCount} ${subtypeCount === 1 ? 'subtype' : 'subtypes'}`);
  }

  // Method override count (when shown as a subtype of a parent)
  if (parentEntry) {
    const parentMethods = index.getFileSymbols(parentEntry.uri.toString())
      .filter(s => (s.kind === 'fun' || s.kind === 'composable') && s.depth > parentEntry.depth);
    if (parentMethods.length > 0) {
      const overrideCount = countOverrides(entry, parentMethods, index);
      if (overrideCount > 0) {
        parts.push(`overrides ${overrideCount}/${parentMethods.length}`);
      }
    }
  }

  return parts.join(' — ');
}

function countOverrides(impl: SymbolEntry, parentMethods: SymbolEntry[], index: SymbolIndex): number {
  const implSymbols = index.getFileSymbols(impl.uri.toString());
  // Find methods in the impl that are between the impl's line and the next class boundary
  let implEnd = Infinity;
  for (const s of implSymbols) {
    if (s.line > impl.line && s.depth <= impl.depth && CLASS_LIKE.has(s.kind)) {
      implEnd = s.line;
      break;
    }
  }
  const implMethods = implSymbols.filter(s =>
    (s.kind === 'fun' || s.kind === 'composable') &&
    s.line > impl.line && s.line < implEnd
  );
  const implMethodNames = new Set(implMethods.map(m => m.name));
  return parentMethods.filter(pm => implMethodNames.has(pm.name)).length;
}

function entryToItem(entry: SymbolEntry, index: SymbolIndex, parentEntry?: SymbolEntry): vscode.TypeHierarchyItem {
  const range = new vscode.Range(entry.line, entry.character, entry.line, entry.character + entry.name.length);
  return new vscode.TypeHierarchyItem(
    toSymbolKind(entry.kind),
    entry.name,
    buildDetail(entry, index, parentEntry),
    entry.uri,
    range,
    range,
  );
}

function sortSubtypes(entries: SymbolEntry[]): SymbolEntry[] {
  return [...entries].sort((a, b) => {
    const orderDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name);
  });
}

export class KotlinTypeHierarchyProvider implements vscode.TypeHierarchyProvider {
  constructor(private readonly index: SymbolIndex) {}

  prepareTypeHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.TypeHierarchyItem[] | null {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    const entries = this.index.lookup(word).filter(e => CLASS_LIKE.has(e.kind));
    if (entries.length === 0) return null;

    return entries.map(e => entryToItem(e, this.index));
  }

  provideTypeHierarchySupertypes(
    item: vscode.TypeHierarchyItem,
  ): vscode.TypeHierarchyItem[] {
    const uriStr = item.uri.toString();
    const line = item.range.start.line;
    const fileSymbols = this.index.getFileSymbols(uriStr);
    const entry = fileSymbols.find(e => e.name === item.name && e.line === line);
    if (!entry?.supertypes) return [];

    const results: vscode.TypeHierarchyItem[] = [];
    for (const st of entry.supertypes) {
      for (const match of this.index.lookup(st)) {
        if (CLASS_LIKE.has(match.kind)) {
          results.push(entryToItem(match, this.index));
        }
      }
    }
    return results;
  }

  provideTypeHierarchySubtypes(
    item: vscode.TypeHierarchyItem,
  ): vscode.TypeHierarchyItem[] {
    // Find the parent entry for override counting
    const uriStr = item.uri.toString();
    const line = item.range.start.line;
    const fileSymbols = this.index.getFileSymbols(uriStr);
    const parentEntry = fileSymbols.find(e => e.name === item.name && e.line === line);

    const subs = sortSubtypes(this.index.lookupImplementations(item.name));
    return subs.map(e => entryToItem(e, this.index, parentEntry));
  }
}
