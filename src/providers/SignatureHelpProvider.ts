import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { readSignature, extractKDoc, parseParams, KtParam, escapeAngleBrackets } from '../util/SignatureReader';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { resolveLocalScope } from './DefinitionProvider';

// Cache: fqn → { sig, params, kdoc } — avoids reopening declaration docs on every keypress
interface SigCache { sig: string; params: KtParam[]; kdoc: string | null }

const WORD_RE = /[A-Za-z_]\w*/;

export class KotlinSignatureHelpProvider implements vscode.SignatureHelpProvider {
  private readonly sigCache = new Map<string, SigCache>();

  constructor(private readonly index: SymbolIndex) {}

  evictFile(_uri: string): void {
    // Cache key is FQN, not URI — clear all on any file change.
    // Signature help recomputes on the next keypress (fast, no JVM).
    this.sigCache.clear();
  }

  dispose(): void {}

  async provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.SignatureHelpContext,
  ): Promise<vscode.SignatureHelp | null> {
    // Dismiss on `)` retrigger
    if (context.triggerCharacter === ')') return null;

    // Dismiss when cursor is inside a comment or string on the current line
    // (a `"${greet(` template is code).
    const currentLineText = document.lineAt(position.line).text;
    const probe = Math.max(0, Math.min(position.character, currentLineText.length - 1));
    if (isInsideCommentOrString(currentLineText, position.character)
      && !isInsideStringInterpolation(currentLineText, probe)) return null;

    // Walk backward to find the enclosing `(`
    const callContext = findCallContext(document, position);
    if (!callContext) return null;

    const { functionName, activeParameter, activeParameterName } = callContext;

    // Skip when the call resolves to a LOCAL binding (e.g. local
    // lambda or function variable shadowing a workspace fn). Showing
    // the workspace function's signature would mislead.
    if (resolveLocalScope(document, position, functionName)) return null;

    // Resolve the function entry
    // Overloads share an FQN: several matches of one FQN are one
    // declaration with several signatures, not an ambiguity. `load(` with
    // two `fun load` used to show nothing at all.
    const sameFqn = (arr: SymbolEntry[]) => arr.length > 0 && arr.every(e => e.fqn === arr[0].fqn);
    const entry = (() => {
      const resolved = resolveBest(functionName, document, fqn => this.index.lookupFqn(fqn));
      if (sameFqn(resolved.matches)) return resolved.matches[0];
      if (resolved.matches.length > 1) return undefined;

      const hits = this.index.lookup(functionName).filter(
        e => e.kind === 'fun' || e.kind === 'composable' || e.kind === 'class' || e.kind === 'dataClass',
      );
      return sameFqn(hits) ? hits[0] : undefined;
    })();

    if (!entry) return null;
    if (token.isCancellationRequested) return null;

    // Every overload of the resolved declaration: `load(id: Int)` and
    // `load(name: String, force: Boolean)` share an FQN, and only the last
    // one indexed was shown, with no way to switch.
    const overloads = this.index.lookup(functionName)
      .filter(e => e.fqn === entry.fqn && e.uri.toString() === entry.uri.toString()
        && (e.kind === 'fun' || e.kind === 'composable' || e.kind === 'class' || e.kind === 'dataClass'))
      .sort((a, b) => a.line - b.line);
    const candidates = overloads.length > 0 ? overloads : [entry];

    const sigs: { info: vscode.SignatureInformation; params: KtParam[] }[] = [];
    for (const cand of candidates) {
      const cached = await this.signatureOf(cand, token);
      if (token.isCancellationRequested) return null;
      if (!cached) continue;
      sigs.push({ info: buildSignatureInformation(cached), params: cached.params });
    }
    if (sigs.length === 0) return null;

    // The signature that can still take the argument being typed, else the
    // longest one (the user typed past every parameter list).
    let active = sigs.findIndex(s => activeParameterName
      ? s.params.some(p => p.name === activeParameterName)
      : s.params.length > activeParameter);
    if (active < 0) active = sigs.reduce((best, s, i) => s.params.length > sigs[best].params.length ? i : best, 0);

    const help = new vscode.SignatureHelp();
    help.signatures = sigs.map(s => s.info);
    help.activeSignature = active;
    const params = sigs[active].params;
    const namedIndex = activeParameterName ? params.findIndex(p => p.name === activeParameterName) : -1;
    help.activeParameter = namedIndex >= 0 ? namedIndex : Math.min(activeParameter, Math.max(0, params.length - 1));

    return help;
  }

  // Signature from cache or parsed from the declaration document. The key
  // carries the line: overloads share an FQN.
  private async signatureOf(entry: SymbolEntry, token: vscode.CancellationToken): Promise<SigCache | null> {
    const key = `${entry.fqn}#${entry.uri.toString()}#${entry.line}`;
    const hit = this.sigCache.get(key);
    if (hit) return hit;
    try {
      const declDoc = await vscode.workspace.openTextDocument(entry.uri);
      if (token.isCancellationRequested) return null;
      const sig = readSignature(declDoc, entry);
      if (!sig) return null;
      const params = parseParams(sig);
      const kdoc = extractKDoc(declDoc, entry.line);
      const cached = { sig, params, kdoc };
      this.sigCache.set(key, cached);
      return cached;
    } catch {
      return null;
    }
  }
}

function buildSignatureInformation(cached: SigCache): vscode.SignatureInformation {
  const { sig, params, kdoc } = cached;
  const sigInfo = new vscode.SignatureInformation(sig);
  if (kdoc) {
    sigInfo.documentation = new vscode.MarkdownString(escapeAngleBrackets(kdoc));
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Build ParameterInformation with [start, end] offsets into the sig string
  sigInfo.parameters = params.map(p => {
    // Word boundary: `x:` used to match the tail of `index: Int`.
    const at = new RegExp(`\\b${esc(p.name)}\\s*:`).exec(sig);
    if (at) {
      const start = at.index;
      // Highlight "name: type" in the signature
      const typeEnd = findTypeEnd(sig, start + at[0].length);
      return new vscode.ParameterInformation([start, typeEnd]);
    }
    // Java: `String tag`, the type comes first.
    const java = new RegExp(`${esc(p.type)}\\s+${esc(p.name)}\\b`).exec(sig);
    if (java) return new vscode.ParameterInformation([java.index, java.index + java[0].length]);
    // Fallback to string label if offset not found
    return new vscode.ParameterInformation(`${p.name}: ${p.type}`);
  });
  return sigInfo;
}

// Walks backward from `position` to find the function name and active parameter index.
// Returns null if the cursor is not inside a function call.
function findCallContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): { functionName: string; activeParameter: number; activeParameterName?: string } | null {
  // Collect text from the current line back up to 20 lines. Comments and
  // string contents are blanked (templates kept): a `,` in "Hello, world"
  // moved the highlight one parameter over, a `)` in ":)" dismissed the
  // popup, and a `// TODO: see show(` above the call brought up show's.
  const startLine = Math.max(0, position.line - 20);
  let text = '';
  const lineOffsets: number[] = []; // maps text index → line number

  for (let ln = startLine; ln <= position.line; ln++) {
    const lineText = document.lineAt(ln).text;
    const endCol = ln === position.line ? position.character : lineText.length;
    const chunk = maskCommentsAndStrings(lineText, endCol) + '\n';
    for (let i = 0; i < chunk.length; i++) lineOffsets.push(ln);
    text += chunk;
  }

  // Walk backward tracking paren depth
  let depth = 0;
  let activeParameter = 0;

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];

    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
      continue;
    }
    // Generic arguments: `emptyMap<String, Int>()` holds a comma that is not
    // an argument separator. A `>` closes a type list when what follows is
    // `(`, `>`, `,`, `)`, `?` or `.`; `a > b` is a comparison.
    if (ch === '>' && text[i - 1] !== '-' && /^\s*[(>,)?.:]/.test(text.slice(i + 1, i + 3))) {
      depth++;
      continue;
    }
    if (ch === '<' && depth > 0 && /^[A-Za-z_*\s]/.test(text[i + 1] ?? '') && /[\w>]/.test(text[i - 1] ?? '')) {
      depth--;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue; }

      // Found the unmatched `(` — extract function name before it
      if (ch !== '(') return null; // only care about function calls

      let j = i - 1;
      // Skip whitespace
      while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;

      // Extract the word
      let nameEnd = j + 1;
      while (j >= 0 && /\w/.test(text[j])) j--;
      const name = text.slice(j + 1, nameEnd).trim();

      if (!name || name.length < 2) return null;
      // Exclude keywords that look like calls
      if (/^(if|else|when|for|while|do|try|catch|finally|return|throw|in)$/.test(name)) return null;

      // `greet(greeting = "Yo", name = |`: the argument being typed is named;
      // its position is meaningless and the highlight sat on the wrong parameter.
      const currentArg = lastTopLevelArgument(text.slice(i + 1));
      const named = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(currentArg)?.[1];
      return { functionName: name, activeParameter, activeParameterName: named };
    }

    if (ch === ',' && depth === 0) {
      activeParameter++;
    }
  }

  return null;
}

// Finds the end index of a type within the signature string, starting after `name:`.
// Stops at `,` or `=` or `)` at bracket depth 0.
function findTypeEnd(sig: string, start: number): number {
  let depth = 0;
  let i = start;
  // skip leading whitespace
  while (i < sig.length && sig[i] === ' ') i++;

  for (; i < sig.length; i++) {
    const ch = sig[i];
    // Skip `->` operator so `>` doesn't decrement depth
    if (ch === '-' && sig[i + 1] === '>') { i++; continue; }
    if (ch === '(' || ch === '<' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === '>' || ch === '}') {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (depth === 0) {
      if (ch === ',') return i;
      if (ch === '=' && sig[i + 1] !== '=') return i;
    }
  }
  return i;
}

/** `line[0..endCol)` with comment and string characters blanked, `${…}` kept. */
function maskCommentsAndStrings(line: string, endCol: number): string {
  let out = '';
  for (let i = 0; i < endCol; i++) {
    // The quotes themselves go too: the line tokens leave a closing quote as
    // code, and lastTopLevelArgument would reopen a string on it.
    const ch = line[i];
    const masked = (ch === '"' || ch === '\'' || isInsideCommentOrString(line, i)) && !isInsideStringInterpolation(line, i);
    out += masked ? ' ' : ch;
  }
  return out;
}

/** The text after the last top-level comma of an argument list. */
function lastTopLevelArgument(args: string): string {
  let depth = 0;
  let quote: string | null = null;
  let last = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) last = i + 1;
  }
  return args.slice(last);
}
