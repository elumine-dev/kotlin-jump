import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { buildAllowFilter } from '../util/testFilter';

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

/**
 * Returns the implementing classes for `entry`, filtered to reduce false positives
 * when multiple classes share the same simple name across packages.
 *
 * The symbol index stores supertypes as simple names (not FQNs), so name collisions
 * produce false positives: implementors of `com.b.Handler` appear as subtypes of
 * `com.a.Handler`. When a collision is detected, we keep only same-package subtypes
 * (safe) plus cross-package subtypes whose own package has no same-name class (they
 * must be importing from outside). Cross-package explicit extensions in colliding
 * namespaces remain a known limitation — full fix requires FQN supertype storage.
 */
function disambiguateSubtypes(impls: SymbolEntry[], parent: SymbolEntry, index: SymbolIndex): SymbolEntry[] {
  const allParents = index.lookup(parent.name).filter(e => CLASS_LIKE.has(e.kind));
  if (allParents.length <= 1) return impls; // no collision — all results are unambiguous
  return impls.filter(impl => {
    if (impl.packageName === parent.packageName) return true; // same package — unambiguous
    // Cross-package: include only when the impl's package has no class with this name,
    // meaning it must extend from outside (possibly this specific parent).
    return !allParents.some(p => p.packageName === impl.packageName);
  });
}

function buildDetail(entry: SymbolEntry, index: SymbolIndex, parentEntry?: SymbolEntry): string {
  const kindLabel = KIND_LABEL[entry.kind] ?? entry.kind;
  const parts: string[] = [kindLabel];

  // File name
  parts.push(fileName(entry.uri));

  // Package
  if (entry.packageName) parts.push(entry.packageName);

  // Subtype count — filtered to reduce false positives from name collisions
  const allImpls = index.lookupImplementations(entry.name);
  const subtypeCount = disambiguateSubtypes(allImpls, entry, index).length;

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

    const allow = buildAllowFilter(document.uri.fsPath);
    const entries = this.index.lookup(word).filter(e => CLASS_LIKE.has(e.kind) && allow(e.uri.path));
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

    const allow = buildAllowFilter(item.uri.fsPath);
    const results: vscode.TypeHierarchyItem[] = [];
    for (const st of entry.supertypes) {
      const candidates = this.index.lookup(st).filter(m => CLASS_LIKE.has(m.kind) && allow(m.uri.path));
      // When multiple classes share this supertype name, prefer same-package to reduce
      // false positives. The parser stores supertypes as simple names, not FQNs, so a
      // name collision across packages otherwise shows both as parents. Same-package is
      // the safest heuristic; cross-package explicit extensions in colliding namespaces
      // remain a known limitation — full fix requires FQN supertype storage.
      const preferred = candidates.length > 1 && entry.packageName
        ? candidates.filter(m => m.packageName === entry.packageName)
        : [];
      (preferred.length > 0 ? preferred : candidates).forEach(m =>
        results.push(entryToItem(m, this.index))
      );
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

    const allow = buildAllowFilter(item.uri.fsPath);
    const allSubs = this.index.lookupImplementations(item.name).filter(e => allow(e.uri.path));
    const subs = parentEntry
      ? sortSubtypes(disambiguateSubtypes(allSubs, parentEntry, this.index))
      : sortSubtypes(allSubs);
    return subs.map(e => entryToItem(e, this.index, parentEntry));
  }
}
