import * as vscode from 'vscode';
import { SUPPRESS_DESCRIPTIONS, lookupSuppression } from '../data/suppressDescriptions';

/**
 * Shows plain-English descriptions when hovering over suppression IDs inside
 * `@Suppress(...)` or `@SuppressLint(...)` annotations.
 *
 *   @Suppress("UNCHECKED_CAST")  // hover on UNCHECKED_CAST → what it means
 *   @SuppressLint("MissingPermission", "NewApi")
 *
 * The provider runs BEFORE the symbol-based KotlinHoverProvider in the
 * resolution order (VS Code merges hovers from all providers, so multiple
 * hits stack cleanly — this one just adds its description to whatever the
 * symbol hover would also show). Kotlin and Java both use the same
 * attribute names since `@Suppress` is a Kotlin annotation and
 * `@SuppressLint` / `@SuppressWarnings` are Java ones.
 */
export class SuppressHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
    const line = document.lineAt(position.line).text;

    // Quick reject: no annotation on this line. Much cheaper than running
    // the word-inside-annotation check on every hover in every file.
    if (!/@(Suppress|SuppressLint|SuppressWarnings)\b/.test(line)) return null;

    // Extract the string literal under the cursor. Both single- and
    // double-quoted IDs are captured; only double-quoted is Kotlin-valid
    // but we accept both for the Java case too.
    const id = extractIdAtCursor(line, position.character);
    if (!id) return null;

    // Must be inside the parentheses of @Suppress/@SuppressLint. This
    // guards against false positives like a plain `"UNCHECKED_CAST"`
    // string somewhere else on the same line.
    if (!isInsideSuppressCall(line, position.character)) return null;

    const desc = lookupSuppression(id);
    if (!desc) return null;

    const md = new vscode.MarkdownString(undefined, true);
    md.supportHtml = false;
    md.appendMarkdown(`**${id}** — ${desc.kind}\n\n${desc.text}`);
    if (desc.docUrl) {
      md.appendMarkdown(`\n\n[Reference](${desc.docUrl})`);
    }
    return new vscode.Hover(md);
  }
}

/** Return the string content under the cursor if the cursor is inside a
 *  `"..."` or `'...'` literal. Returns null if the cursor is outside a
 *  string. Handles escaped quotes minimally (`\"` inside the string). */
function extractIdAtCursor(line: string, col: number): string | null {
  // Scan left to find the opening quote
  let start = -1;
  let quote = '';
  for (let i = col - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      // Is it escaped?
      if (i > 0 && line[i - 1] === '\\') continue;
      start = i + 1;
      quote = ch;
      break;
    }
    // A line terminator equivalent — give up.
    if (ch === ';' || ch === ')') return null;
  }
  if (start < 0) return null;

  // Scan right to find the closing quote
  let end = -1;
  for (let i = Math.max(col, start); i < line.length; i++) {
    if (line[i] === quote && line[i - 1] !== '\\') { end = i; break; }
  }
  if (end < 0) return null;
  if (col < start - 1 || col > end) return null;

  const content = line.slice(start, end);
  // Sanity: suppression IDs are identifiers, digits, dots. Reject obvious
  // non-IDs (like a sentence inside a random string literal on this line).
  if (!/^[A-Za-z_][\w.]*$/.test(content)) return null;
  return content;
}

/** True when the given column is inside the parenthesized argument list of
 *  `@Suppress(...)` / `@SuppressLint(...)` / `@SuppressWarnings(...)` on
 *  this line. */
function isInsideSuppressCall(line: string, col: number): boolean {
  const re = /@(Suppress|SuppressLint|SuppressWarnings)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const openParen = m.index + m[0].length - 1;
    if (col <= openParen) continue;
    // Find matching close paren (balanced, no string-aware scan needed —
    // suppression arguments are simple string literals without nested
    // parentheses).
    let depth = 1;
    for (let i = openParen + 1; i < line.length; i++) {
      if (line[i] === '(') depth++;
      else if (line[i] === ')') {
        depth--;
        if (depth === 0) {
          return col > openParen && col < i + 1;
        }
      }
    }
    // Unclosed — assume still inside (multi-line @Suppress is rare but valid).
    return true;
  }
  return false;
}

export { SUPPRESS_DESCRIPTIONS };
