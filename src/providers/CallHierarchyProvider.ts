import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { scanForUsagesWithTarget, isExcluded, resolveSearchTarget } from './FindUsagesEngine';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { resolveLocalScope } from './DefinitionProvider';
import { bodyEndLine } from '../util/symbolRanges';

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
const HOLDER_CLASS_KINDS = new Set<SymbolKind>(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum', 'annotation']);

/**
 * Returns the column offset of the expression body start (after `= `) on a single-line
 * function declaration, or -1 if the line is a block-body function or has no `=`.
 * Tracks paren depth so default parameter values (`fun f(x: Int = 0)`) are not confused
 * with the expression-body `=`.
 */
/**
 * Finds where the scannable body of a function starts on its declaration line.
 * Returns the scan offset for:
 *   - expression body:  `fun f() = expr`  → offset of `expr`
 *   - inline block body: `fun f() { call() }` → offset after `{`
 * Returns -1 if the body is a normal multi-line block (scan body lines instead).
 * Tracks paren depth so default parameter values (`fun f(x: Int = 0)`) are not
 * confused with the expression-body `=`.
 */
function findDeclarationLineScanStart(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth > 0) continue;
    if (ch === '{') return i + 1;  // inline block body — scan from after `{`
    if (ch === '=') {
      let start = i + 1;
      while (start < line.length && line[start] === ' ') start++;
      return start;
    }
  }
  return -1;
}

function fileName(uri: { path?: string; toString(): string }): string {
  const last = (uri.path ?? uri.toString()).split('/').pop() ?? '';
  try { return decodeURIComponent(last); } catch { return last; }
}

function entryToItem(entry: SymbolEntry): vscode.CallHierarchyItem {
  const selRange = new vscode.Range(entry.line, entry.character, entry.line, entry.character + entry.name.length);
  const kind = FUN_KINDS.has(entry.kind)
    ? (entry.depth > 0 ? vscode.SymbolKind.Method : vscode.SymbolKind.Function)
    : (entry.kind === 'val' || entry.kind === 'var') ? vscode.SymbolKind.Property : vscode.SymbolKind.Class;
  const item = new vscode.CallHierarchyItem(
    kind,
    entry.name,
    entry.packageName ? `${fileName(entry.uri)} — ${entry.packageName}` : fileName(entry.uri),
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

    // Plain string / comment guard.
    if (document.languageId === 'kotlin' || document.languageId === 'java') {
      const lineText = document.lineAt(position.line).text;
      const start    = wordRange.start.character;
      if (isInsideCommentOrString(lineText, start)) {
        const isShortInterp = start >= 1 && lineText[start - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(lineText, start);
        if (!isShortInterp && !isFullInterp) return null;
      }
    }
    // Local-scope guard: parameters / locals are not call hierarchy roots.
    if (resolveLocalScope(document, position, word)) return null;

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
    // Resolve the target up-front. `private` has no cross-file callers in
    // valid code — scan only the declaring file. Skips the workspace-wide
    // URI parse + picomatch glob filter.
    const target = resolveSearchTarget(item.name, doc, this.index);
    const uriStrings = target?.isPrivate
      ? [target.uri.toString()]
      : this.index.fileUriStrings().filter(u => !isExcluded(u));
    const results = await scanForUsagesWithTarget(
      item.name,
      target,
      this.index,
      uriStrings,
      token,
    );
    if (token.isCancellationRequested) return [];

    // Group by containing function
    const callers = new Map<string, { entry: SymbolEntry; ranges: vscode.Range[] }>();
    // The text of each file with a hit, read once: the holder of a call is
    // found by matching braces, the symbol list alone put the `init` block
    // inside the property declared above it.
    const linesByUri = new Map<string, string[] | undefined>();
    const linesOf = async (uriString: string): Promise<string[] | undefined> => {
      if (linesByUri.has(uriString)) return linesByUri.get(uriString);
      let lines: string[] | undefined;
      try { lines = (await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString))).getText().split('\n'); }
      catch { lines = undefined; }
      linesByUri.set(uriString, lines);
      return lines;
    };

    // Every line that DECLARES this name, whatever the language writes on it.
    // The `fun …` shape below only ever matched Kotlin, so a Java overload
    // (`protected void initDagger(Context c)`) came back as its own caller.
    const declaredAt = new Set(
      this.index.lookup(item.name).map(d => `${d.uri.toString()}:${d.line}`),
    );

    for (const r of results) {
      // Skip the declaration itself
      const data = (item as any).data;
      if (data && r.uriString === data.uriString && r.line === data.line) continue;

      // The declaration line of an overload (`fun load(name: String)`) is not a call.
      if (declaredAt.has(`${r.uriString}:${r.line}`)) continue;
      if (new RegExp(`\\bfun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>?]+\\.)?${item.name}\\s*\\(`).test(r.lineText)) continue;
      const container = this.findContainingFunction(r.uriString, r.line, await linesOf(r.uriString));
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

    // Find the scan start for expression body (`fun f() = expr`) or inline block
    // body (`fun f() { call() }`) on the declaration line.
    const declLineText = doc.lineAt(entry.line).text;
    const declLineScanStart = findDeclarationLineScanStart(declLineText);

    // No multi-line body AND nothing scannable on the declaration line → no calls.
    if (bodyStart > bodyEnd && declLineScanStart === -1) return [];

    // Extract outgoing calls from body lines
    const outgoing = new Map<string, { entry: SymbolEntry; ranges: vscode.Range[] }>();

    // Resolve the target for a call name, disambiguating via import context when multiple
    // declarations share the same simple name across packages.
    const resolveTarget = (name: string): SymbolEntry | null => {
      const all = this.index.lookup(name).filter(e => FUN_KINDS.has(e.kind));
      if (all.length === 0) return null;
      if (all.length === 1) return all[0];
      const resolved = resolveSearchTarget(name, doc, this.index);
      return (resolved && FUN_KINDS.has(resolved.kind)) ? resolved : all[0];
    };

    // Scan declaration line for expression-body or inline-block calls
    if (declLineScanStart !== -1) {
      RE_CALL.lastIndex = declLineScanStart;
      let m;
      while ((m = RE_CALL.exec(declLineText)) !== null) {
        if (token.isCancellationRequested) return [];
        const name = m[2];
        if (KEYWORDS.has(name)) continue;
        const matchStart = m[1] ? m.index + m[1].length + 1 : m.index;
        if (isInsideCommentOrString(declLineText, matchStart)) continue;
        const target = resolveTarget(name);
        if (!target) continue;
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

        const target = resolveTarget(name);
        if (!target) continue;

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

  private findContainingFunction(uriString: string, callLine: number, lines?: string[]): SymbolEntry | undefined {
    const symbols = this.index.getFileSymbols(uriString);
    const endOf = (i: number): number => lines
      ? bodyEndLine(lines, symbols, i, lines.length - 1)
      : this.getFunctionBodyEnd(uriString, symbols[i]);
    let best: SymbolEntry | undefined;
    let bestIdx = -1;
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      if (s.line > callLine) break;
      if (FUN_KINDS.has(s.kind)) { best = s; bestIdx = i; }
    }
    // A call in a property initializer, an init block or a class declared
    // after a function used to be attributed to that previous function.
    if (best && callLine <= endOf(bestIdx)) return best;
    // Not inside a function: the property whose initializer holds the call
    // (`val state = flow.map { other() }`, `by lazy { create() }`) or, for an
    // `init` block, the class. Dropping the call showed "No callers".
    let holder: SymbolEntry | undefined;
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      if (s.line > callLine) break;
      if (s.kind !== 'val' && s.kind !== 'var' && !HOLDER_CLASS_KINDS.has(s.kind)) continue;
      if (s.name.startsWith('$')) continue;
      if (callLine <= endOf(i)) holder = s;
    }
    return holder;
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
