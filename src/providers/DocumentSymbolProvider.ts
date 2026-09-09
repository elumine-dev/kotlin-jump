import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { bodyEndLine } from '../util/symbolRanges';
import { symbolsForDocument } from '../util/liveSymbols';
import { ANON_KEYWORD_LENGTH, displayName, isAnonymousObject } from '../util/anonymousObjects';

export class KotlinDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.DocumentSymbol[] {
    // The index follows the file on disk. While the document is dirty the
    // outline pointed lines above or below its targets, and a deletion at
    // the end of the file made lineAt() throw and emptied the outline.
    // Locals of a function body are indexed (Go to Definition needs them)
    // but they are not structure: IntelliJ's view does not list them either.
    const entries = symbolsForDocument(this.index, document).filter(e => !e.isLocal);
    if (entries.length === 0) return [];

    const lastLine = document.lineCount - 1;
    const docLines = document.getText().split('\n');
    const roots: vscode.DocumentSymbol[] = [];
    const stack: { sym: vscode.DocumentSymbol; entry: SymbolEntry; depth: number }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      // Pop before resolving the icon: the stack top must be the parent, not
      // the previous sibling. With the pop after, the enum class that follows
      // another enum's entries got the EnumMember icon of that last entry.
      while (stack.length > 0 && stack[stack.length - 1].depth >= e.depth) {
        stack.pop();
      }
      // Depth alone is not containment. An `object :` inside an `init { }`
      // block sits one level deeper than the class body, so it landed under
      // whatever property came last, whose extent had ended lines earlier.
      // The breadcrumb then read `Holder > disposable > object : Callback`.
      while (stack.length > 0 && stack[stack.length - 1].sym.range.end.line < e.line) {
        stack.pop();
      }

      const lineText   = document.lineAt(e.line).text;
      const visibility = extractVisibility(lineText, e.character);
      const detail     = buildDetail(e, visibility);
      const kind       = resolveKind(e, visibility, stack[stack.length - 1]?.entry);
      const tags: vscode.SymbolTag[] | undefined = e.isDeprecated ? [vscode.SymbolTag.Deprecated] : undefined;

      // A synthetic `$anon$<line>` reads as what the source says, and its
      // selection covers the `object` keyword: the name has no text to point at.
      const label     = displayName(e);
      const nameWidth = isAnonymousObject(e.name) ? ANON_KEYWORD_LENGTH : e.name.length;
      const nameStart = new vscode.Position(e.line, e.character);
      const nameEnd   = new vscode.Position(e.line, e.character + nameWidth);
      const endLine   = bodyEndLine(docLines, entries, i, lastLine);
      const bodyEnd   = document.lineAt(endLine).range.end;

      const sym = new vscode.DocumentSymbol(
        label,
        detail,
        kind,
        new vscode.Range(nameStart, bodyEnd),
        new vscode.Range(nameStart, nameEnd),
      );
      if (tags) sym.tags = tags;

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

// Only the modifiers of THIS declaration count: the text before the name,
// cut at the last delimiter. `class Foo @Inject constructor(private val x)`
// is a public class, and in `(private val a, val b)` only `a` is private.
function extractVisibility(lineText: string, nameStart: number): string {
  const before = lineText.slice(0, nameStart);
  const cut = Math.max(before.lastIndexOf('('), before.lastIndexOf(','), before.lastIndexOf('{'), before.lastIndexOf(';'));
  const own = before.slice(cut + 1);
  if (/\bprivate\b/.test(own))   return 'private';
  if (/\bprotected\b/.test(own)) return 'protected';
  if (/\binternal\b/.test(own))  return 'internal';
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
