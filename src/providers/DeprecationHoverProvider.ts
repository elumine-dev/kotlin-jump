import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;

// First string argument of @Deprecated, positional or named.
const MESSAGE_RE = /@Deprecated\s*\(\s*(?:message\s*=\s*)?"((?:[^"\\]|\\.)*)"/;
// The ReplaceWith expression, wherever it sits in the annotation.
const REPLACE_WITH_RE = /ReplaceWith\s*\(\s*"((?:[^"\\]|\\.)*)"/;

// Lines of declaration-site context read above the symbol. @Deprecated plus
// a ReplaceWith and a couple of other annotations fit comfortably in 8.
const CONTEXT_LINES = 8;

/**
 * Hover card for deprecated symbols: the @Deprecated message and its
 * ReplaceWith expression, read from the declaration site.
 *
 *   @Deprecated("Use fetchV2", ReplaceWith("fetchV2(id)"))
 *   fun fetch(id: Int)
 *
 *   fetch(7)   // hover → Deprecated: Use fetchV2 · Replace with: fetchV2(id)
 *
 * The index only stores the isDeprecated flag (the parser's annotation
 * window is line-oriented and capped, so a multi-line @Deprecated loses its
 * arguments there). The full annotation is re-read from the declaring file
 * on hover instead: it happens only for symbols already flagged deprecated,
 * and the document is usually already in VS Code's cache.
 */
export class DeprecationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Same ambiguity policy as KotlinHoverProvider: a wrong "deprecated"
    // banner on a same-name symbol is worse than no banner.
    let entry = undefined;
    const resolved = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    if (resolved.matches.length === 1) {
      entry = resolved.matches[0];
    } else if (resolved.matches.length > 1) {
      return null;
    } else {
      const hits = this.index.lookup(word);
      if (hits.length === 1) entry = hits[0];
    }
    if (!entry?.isDeprecated) return null;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Deprecated** \`${entry.name}\``);

    const annotation = await this.readAnnotation(entry.uri, entry.line);
    if (annotation) {
      const message = MESSAGE_RE.exec(annotation)?.[1];
      const replaceWith = REPLACE_WITH_RE.exec(annotation)?.[1];
      if (message) md.appendMarkdown(`: ${unescape(message)}`);
      if (replaceWith) {
        md.appendMarkdown('\n\nReplace with:');
        md.appendCodeblock(unescape(replaceWith), 'kotlin');
      }
    }
    return new vscode.Hover(md, wordRange);
  }

  private async readAnnotation(uri: vscode.Uri, declLine: number): Promise<string | null> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!doc) return null;
      const from = Math.max(0, declLine - CONTEXT_LINES);
      const lines: string[] = [];
      for (let i = from; i <= declLine && i < doc.lineCount; i++) {
        lines.push(doc.lineAt(i).text);
      }
      return lines.join(' ');
    } catch {
      return null;   // JAR entries or deleted files: flag-only hover
    }
  }
}

/** Undo Kotlin string escapes in annotation arguments (`\"` and `\\`). */
function unescape(s: string): string {
  return s.replace(/\\(["\\])/g, '$1');
}
