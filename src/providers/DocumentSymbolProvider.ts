import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { rangeEndLine } from '../util/symbolRanges';

export class KotlinDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.DocumentSymbol[] {
    const entries = this.index.getFileSymbols(document.uri.toString());
    if (entries.length === 0) return [];

    const lastLine = document.lineCount - 1;
    const roots: vscode.DocumentSymbol[] = [];
    const stack: { sym: vscode.DocumentSymbol; entry: SymbolEntry; depth: number }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      const lineText   = document.lineAt(e.line).text;
      const visibility = extractVisibility(lineText);
      const detail     = buildDetail(e, visibility);
      const kind       = resolveKind(e, visibility, stack[stack.length - 1]?.entry);
      const tags: vscode.SymbolTag[] | undefined = e.isDeprecated ? [vscode.SymbolTag.Deprecated] : undefined;

      const nameStart = new vscode.Position(e.line, e.character);
      const nameEnd   = new vscode.Position(e.line, e.character + e.name.length);
      const endLine   = rangeEndLine(entries, i, lastLine);
      const bodyEnd   = document.lineAt(endLine).range.end;

      const sym = new vscode.DocumentSymbol(
        e.name,
        detail,
        kind,
        new vscode.Range(nameStart, bodyEnd),
        new vscode.Range(nameStart, nameEnd),
      );
      if (tags) sym.tags = tags;

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

// ── Detail field ─────────────────────────────────────────────────────────────
//
// Shows key modifiers in the Outline and breadcrumbs, e.g.:
//   "private suspend override"   "const"   "abstract"   "inline extension"
//
// Sources: VS Code symbolIcons.css, kotlin-language-server, JetBrains Kotlin plugin

function buildDetail(e: SymbolEntry, visibility: string): string {
  const parts: string[] = [];
  if (visibility)    parts.push(visibility);
  if (e.isAbstract)  parts.push('abstract');
  if (e.isSuspend)   parts.push('suspend');
  if (e.isOverride)  parts.push('override');
  if (e.isInline)    parts.push('inline');
  if (e.isInfix)     parts.push('infix');
  if (e.isOperator)  parts.push('operator');
  if (e.isConst)     parts.push('const');
  if (e.isLateinit)  parts.push('lateinit');
  if (e.isExtension) parts.push('extension');
  return parts.join(' ');
}

// ── Visibility extraction ─────────────────────────────────────────────────────

function extractVisibility(lineText: string): string {
  if (/\bprivate\b/.test(lineText))   return 'private';
  if (/\bprotected\b/.test(lineText)) return 'protected';
  if (/\binternal\b/.test(lineText))  return 'internal';
  return '';
}

// ── Icon resolution ───────────────────────────────────────────────────────────
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
      return vscode.SymbolKind.Object;

    case 'enum':
      if (parentEntry?.kind === 'enum') return vscode.SymbolKind.EnumMember;
      return vscode.SymbolKind.Enum;

    case 'typealias':
      return vscode.SymbolKind.Interface;

    case 'fun':
    case 'composable':
      return isMember ? vscode.SymbolKind.Method : vscode.SymbolKind.Function;

    case 'val':
      if (!isMember) return vscode.SymbolKind.Constant;
      return isPrivateOrProtected ? vscode.SymbolKind.Field : vscode.SymbolKind.Property;

    case 'var':
      if (!isMember) return vscode.SymbolKind.Variable;
      return isPrivateOrProtected ? vscode.SymbolKind.Field : vscode.SymbolKind.Property;
  }
}
