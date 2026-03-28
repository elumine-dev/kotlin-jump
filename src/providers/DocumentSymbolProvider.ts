import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind as KtKind } from '../indexer/KotlinParser';

export class KotlinDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const entries = this.index.getFileSymbols(document.uri.toString());
    const roots: vscode.DocumentSymbol[] = [];
    const stack: { sym: vscode.DocumentSymbol; entry: SymbolEntry; depth: number }[] = [];

    for (const e of entries) {
      const lineText   = document.lineAt(e.line).text;
      const visibility = getVisibility(lineText);
      const parent     = stack.length > 0 ? stack[stack.length - 1] : null;

      const symbolKind = resolveKind(e, visibility, parent?.entry);

      const nameStart = new vscode.Position(e.line, e.character);
      const nameEnd   = new vscode.Position(e.line, e.character + e.name.length);
      const lineEnd   = document.lineAt(e.line).range.end;

      const sym = new vscode.DocumentSymbol(
        e.name,
        visibility,   // detail: 'private' | 'protected' | 'internal' | '' (public)
        symbolKind,
        new vscode.Range(nameStart, lineEnd),
        new vscode.Range(nameStart, nameEnd),
      );

      // Pop stack until we find a symbol at a shallower depth
      while (stack.length > 0 && stack[stack.length - 1].depth >= e.depth) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(sym);
      } else {
        stack[stack.length - 1].sym.children.push(sym);
      }

      stack.push({ sym, entry: e, depth: e.depth });
    }

    return roots;
  }
}

// ── Icon resolution ───────────────────────────────────────────────────────────
//
// Sources: VS Code symbolIcons.css, kotlin-language-server Symbols.kt,
//          eclipse.jdt.ls SymbolUtils.java, TypeScript extension documentSymbol.ts
//
//  Class        amber crossing-arrows     → class, sealed class, annotation class
//  Struct       box-with-header (white)   → data class (data holder, not a full class)
//  Interface    blue circle-and-line      → interface, typealias
//  Object       { } curly braces          → object (singleton — semantic match)
//  Enum         amber overlapping rects   → enum class
//  EnumMember   blue overlapping rects    → enum entries (children of Enum)
//  Method       purple hexagon            → member fun (depth > 0)
//  Function     purple hexagon            → top-level fun (depth === 0)
//  Property     wrench icon               → public/internal val or var members
//  Field        blue 3D box               → private/protected val or var members
//  Constant     box-with-lines            → const val (compile-time constant)
//  Variable     blue cube-with-brackets   → top-level var

function resolveKind(
  e: SymbolEntry,
  visibility: string,
  parentEntry: SymbolEntry | undefined,
): vscode.SymbolKind {
  const isPrivateOrProtected = visibility === 'private' || visibility === 'protected';
  const isMember = e.depth > 0;

  switch (e.kind) {
    case 'class':
    case 'sealedClass':
    case 'annotation':
      return vscode.SymbolKind.Class;

    case 'dataClass':
      return vscode.SymbolKind.Struct;

    case 'interface':
      return vscode.SymbolKind.Interface;

    case 'object':
      // { } glyph — more semantically correct than Class for singletons
      return vscode.SymbolKind.Object;

    case 'enum':
      // Enum entries are children of an enum class — use EnumMember (blue)
      // vs Enum (amber) for the class itself
      if (parentEntry?.kind === 'enum') return vscode.SymbolKind.EnumMember;
      return vscode.SymbolKind.Enum;

    case 'typealias':
      return vscode.SymbolKind.Interface;

    case 'fun':
    case 'composable':
      // Member functions → Method icon; top-level → Function icon
      // Both render the same purple hexagon but convey correct semantics
      return isMember ? vscode.SymbolKind.Method : vscode.SymbolKind.Function;

    case 'val':
      if (!isMember) return vscode.SymbolKind.Constant;  // top-level val
      return isPrivateOrProtected ? vscode.SymbolKind.Field : vscode.SymbolKind.Property;

    case 'var':
      if (!isMember) return vscode.SymbolKind.Variable;
      return isPrivateOrProtected ? vscode.SymbolKind.Field : vscode.SymbolKind.Property;
  }
}

// ── Visibility extraction ─────────────────────────────────────────────────────

function getVisibility(lineText: string): string {
  if (/\bprivate\b/.test(lineText))   return 'private';
  if (/\bprotected\b/.test(lineText)) return 'protected';
  if (/\binternal\b/.test(lineText))  return 'internal';
  return '';
}
