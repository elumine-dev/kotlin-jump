import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { readSignature, extractKDoc, parseParams, KtParam } from '../util/SignatureReader';
import { isInsideCommentOrString } from '../util/textUtils';

// Cache: fqn → { sig, params, kdoc } — avoids reopening declaration docs on every keypress
interface SigCache { sig: string; params: KtParam[]; kdoc: string | null }

const WORD_RE = /[A-Za-z_]\w*/;

export class KotlinSignatureHelpProvider implements vscode.SignatureHelpProvider {
  private readonly sigCache = new Map<string, SigCache>();

  constructor(private readonly index: SymbolIndex) {}

  async provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.SignatureHelpContext,
  ): Promise<vscode.SignatureHelp | null> {
    // Dismiss on `)` retrigger
    if (context.triggerCharacter === ')') return null;

    // Dismiss when cursor is inside a comment or string on the current line
    const currentLineText = document.lineAt(position.line).text;
    if (isInsideCommentOrString(currentLineText, position.character)) return null;

    // Walk backward to find the enclosing `(`
    const callContext = findCallContext(document, position);
    if (!callContext) return null;

    const { functionName, activeParameter } = callContext;

    // Resolve the function entry
    const entry = (() => {
      const resolved = resolveBest(functionName, document, fqn => this.index.lookupFqn(fqn));
      if (resolved.matches.length === 1) return resolved.matches[0];
      if (resolved.matches.length > 1) return undefined;

      const hits = this.index.lookup(functionName).filter(
        e => e.kind === 'fun' || e.kind === 'composable' || e.kind === 'class' || e.kind === 'dataClass',
      );
      return hits.length === 1 ? hits[0] : undefined;
    })();

    if (!entry) return null;
    if (token.isCancellationRequested) return null;

    // Get signature from cache or parse it
    let cached = this.sigCache.get(entry.fqn);
    if (!cached) {
      try {
        const declDoc = await vscode.workspace.openTextDocument(entry.uri);
        if (token.isCancellationRequested) return null;

        const sig = readSignature(declDoc, entry);
        if (!sig) return null;

        const params = parseParams(sig);
        const kdoc = extractKDoc(declDoc, entry.line);
        cached = { sig, params, kdoc };
        this.sigCache.set(entry.fqn, cached);
      } catch {
        return null;
      }
    }

    if (!cached || !cached.sig) return null;

    const { sig, params, kdoc } = cached;

    // Build SignatureInformation
    const sigInfo = new vscode.SignatureInformation(sig);

    if (kdoc) {
      sigInfo.documentation = new vscode.MarkdownString(kdoc);
    }

    // Build ParameterInformation with [start, end] offsets into the sig string
    sigInfo.parameters = params.map(p => {
      const needle = `${p.name}:`;
      const start = sig.indexOf(needle);
      if (start !== -1) {
        // Highlight "name: type" in the signature
        const typeEnd = findTypeEnd(sig, start + needle.length);
        return new vscode.ParameterInformation([start, typeEnd]);
      }
      // Fallback to string label if offset not found
      return new vscode.ParameterInformation(`${p.name}: ${p.type}`);
    });

    const help = new vscode.SignatureHelp();
    help.signatures = [sigInfo];
    help.activeSignature = 0;
    help.activeParameter = Math.min(activeParameter, Math.max(0, params.length - 1));

    return help;
  }
}

// Walks backward from `position` to find the function name and active parameter index.
// Returns null if the cursor is not inside a function call.
function findCallContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): { functionName: string; activeParameter: number } | null {
  // Collect text from the current line back up to 20 lines
  const startLine = Math.max(0, position.line - 20);
  let text = '';
  const lineOffsets: number[] = []; // maps text index → line number

  for (let ln = startLine; ln <= position.line; ln++) {
    const lineText = document.lineAt(ln).text;
    const endCol = ln === position.line ? position.character : lineText.length;
    const chunk = lineText.slice(0, endCol) + '\n';
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

      return { functionName: name, activeParameter };
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
