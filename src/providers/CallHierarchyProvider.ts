import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { scanForUsages, isExcluded } from './FindUsagesEngine';
import { isInsideCommentOrString } from '../util/textUtils';

const WORD_RE = /[A-Za-z_]\w*/;
// Matches: method(, method<T>(, method {, obj.method(
const RE_CALL = /(?:(\w+)\.)?([a-zA-Z_]\w*)\s*(?:\(|<[^>]*>\s*\(|\{)/g;

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'when', 'return', 'throw', 'try', 'catch',
  'finally', 'class', 'fun', 'val', 'var', 'import', 'package', 'new',
  'this', 'super', 'is', 'as', 'in', 'null', 'true', 'false', 'typeof',
  'instanceof', 'do', 'break', 'continue', 'object', 'interface',
]);

const FUN_KINDS = new Set<SymbolKind>(['fun', 'composable']);

/**
 * Returns the column offset of the expression body start (after `= `) on a single-line
 * function declaration, or -1 if the line is a block-body function or has no `=`.
 * Tracks paren depth so default parameter values (`fun f(x: Int = 0)`) are not confused
 * with the expression-body `=`.
 */
function findExpressionBodyStart(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth > 0) continue;
    if (ch === '{') return -1;           // block body — no expression body on this line
    if (ch === '=') {
      let start = i + 1;
      while (start < line.length && line[start] === ' ') start++;
      return start;
    }
  }
  return -1;
}

function fileName(uri: { toString(): string }): string {
  return uri.toString().split('/').pop() ?? '';
}

function entryToItem(entry: SymbolEntry): vscode.CallHierarchyItem {
  const selRange = new vscode.Range(entry.line, entry.character, entry.line, entry.character + entry.name.length);
  const item = new vscode.CallHierarchyItem(
    entry.depth > 0 ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
    entry.name,
    `${fileName(entry.uri)} — ${entry.packageName || ''}`,
    entry.uri,
    selRange,
    selRange,
  );
  (item as any).data = { uriString: entry.uri.toString(), line: entry.line, name: entry.name };
  return item;
}

export class KotlinCallHierarchyProvider implements vscode.CallHierarchyProvider {
  constructor(private readonly index: SymbolIndex) {}

  prepareCallHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CallHierarchyItem[] | null {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Try exact match on this line first (cursor is on a declaration)
    const fileSymbols = this.index.getFileSymbols(document.uri.toString());
    const exact = fileSymbols.find(s =>
      s.name === word && s.line === position.line && FUN_KINDS.has(s.kind)
    );
    if (exact) return [entryToItem(exact)];

    // Fallback: the cursor is on a call site — resolve to the function definition
    const entries = this.index.lookup(word).filter(e => FUN_KINDS.has(e.kind));
    if (entries.length === 0) return null;

    return entries.map(entryToItem);
  }

  async provideCallHierarchyIncomingCalls(
    item: vscode.CallHierarchyItem,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyIncomingCall[]> {
    const doc = await vscode.workspace.openTextDocument(item.uri);
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));
    const results = await scanForUsages(
      item.name,
      doc,
      this.index,
      uriStrings,
      token,
    );
    if (token.isCancellationRequested) return [];

    // Group by containing function
    const callers = new Map<string, { entry: SymbolEntry; ranges: vscode.Range[] }>();

    for (const r of results) {
      // Skip the declaration itself
      const data = (item as any).data;
      if (data && r.uriString === data.uriString && r.line === data.line) continue;

      const container = this.findContainingFunction(r.uriString, r.line);
      if (!container) continue;

      const key = `${container.uri.toString()}:${container.line}`;
      if (!callers.has(key)) {
        callers.set(key, { entry: container, ranges: [] });
      }
      callers.get(key)!.ranges.push(
        new vscode.Range(r.line, r.character, r.line, r.character + item.name.length)
      );
    }

    return [...callers.values()].map(({ entry, ranges }) =>
      new vscode.CallHierarchyIncomingCall(entryToItem(entry), ranges)
    );
  }

  async provideCallHierarchyOutgoingCalls(
    item: vscode.CallHierarchyItem,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyOutgoingCall[]> {
    const data = (item as any).data;
    if (!data) return [];

    const entry = this.index.getFileSymbols(data.uriString)
      .find((s: SymbolEntry) => s.name === data.name && s.line === data.line);
    if (!entry) return [];

    // Read the function body
    const doc = await vscode.workspace.openTextDocument(item.uri);
    const bodyEnd = this.getFunctionBodyEnd(data.uriString, entry);
    const bodyStart = entry.line + 1;

    // Check for expression-body syntax on the declaration line: fun f() = expr
    const declLineText = doc.lineAt(entry.line).text;
    const exprBodyOffset = findExpressionBodyStart(declLineText);

    if (bodyStart > bodyEnd && exprBodyOffset === -1) return [];

    // Extract outgoing calls from body lines
    const outgoing = new Map<string, { entry: SymbolEntry; ranges: vscode.Range[] }>();

    // Scan declaration line for expression-body calls
    if (exprBodyOffset !== -1) {
      RE_CALL.lastIndex = exprBodyOffset;
      let m;
      while ((m = RE_CALL.exec(declLineText)) !== null) {
        if (token.isCancellationRequested) return [];
        const name = m[2];
        if (KEYWORDS.has(name)) continue;
        const matchStart = m[1] ? m.index + m[1].length + 1 : m.index;
        if (isInsideCommentOrString(declLineText, matchStart)) continue;
        const targets = this.index.lookup(name).filter(e => FUN_KINDS.has(e.kind));
        if (targets.length === 0) continue;
        const target = targets[0];
        const key = `${target.uri.toString()}:${target.line}`;
        if (!outgoing.has(key)) outgoing.set(key, { entry: target, ranges: [] });
        outgoing.get(key)!.ranges.push(
          new vscode.Range(entry.line, matchStart, entry.line, matchStart + name.length)
        );
      }
    }

    for (let i = bodyStart; i <= bodyEnd && i < doc.lineCount; i++) {
      if (token.isCancellationRequested) return [];
      const lineText = doc.lineAt(i).text;

      RE_CALL.lastIndex = 0;
      let m;
      while ((m = RE_CALL.exec(lineText)) !== null) {
        const name = m[2];
        if (KEYWORDS.has(name)) continue;
        const matchStart = m[1] ? m.index + m[1].length + 1 : m.index; // skip "receiver."
        if (isInsideCommentOrString(lineText, matchStart)) continue;

        // Resolve to an indexed function
        const targets = this.index.lookup(name).filter(e => FUN_KINDS.has(e.kind));
        if (targets.length === 0) continue;

        const target = targets[0];
        const key = `${target.uri.toString()}:${target.line}`;
        if (!outgoing.has(key)) {
          outgoing.set(key, { entry: target, ranges: [] });
        }
        outgoing.get(key)!.ranges.push(
          new vscode.Range(i, matchStart, i, matchStart + name.length)
        );
      }
    }

    return [...outgoing.values()].map(({ entry: e, ranges }) =>
      new vscode.CallHierarchyOutgoingCall(entryToItem(e), ranges)
    );
  }

  private findContainingFunction(uriString: string, callLine: number): SymbolEntry | undefined {
    const symbols = this.index.getFileSymbols(uriString);
    let best: SymbolEntry | undefined;
    for (const s of symbols) {
      if (s.line > callLine) break;
      if (FUN_KINDS.has(s.kind)) best = s;
    }
    return best;
  }

  private getFunctionBodyEnd(uriString: string, entry: SymbolEntry): number {
    const symbols = this.index.getFileSymbols(uriString);
    let found = false;
    for (const s of symbols) {
      if (!found) {
        if (s.line === entry.line && s.name === entry.name) found = true;
        continue;
      }
      if (s.depth <= entry.depth) return s.line - 1;
    }
    return entry.line + 100; // last function in file — generous bound
  }
}
