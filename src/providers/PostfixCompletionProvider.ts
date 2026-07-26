import * as vscode from 'vscode';
import { isInsideCommentOrString } from '../util/textUtils';

/**
 * KJ-002: IntelliJ-style postfix completion: `expr.let` → `expr.let { }`,
 * `expr.null` → `if (expr == null) { }`, etc. Purely textual
 * transformation: the receiver is found by balancing delimiters backwards,
 * no type information required.
 */

export const POSTFIX_TEMPLATES = [
  'let', 'val', 'if', 'null', 'notnull', 'for', 'when', 'try', 'not',
] as const;

export type PostfixTemplate = (typeof POSTFIX_TEMPLATES)[number];

/**
 * Full receiver preceding the `.` located at `dotIndex`.
 * Walks back over access chains (`a?.b.c`), calls with arguments and
 * trailing lambdas; stops on a space outside delimiters (except the space
 * preceding a trailing lambda), on an operator or at the start of the line.
 */
export function extractReceiver(lineText: string, dotIndex: number): string | null {
  if (lineText[dotIndex] !== '.') return null;

  let i = dotIndex - 1;
  let depth = 0;

  while (i >= 0) {
    const ch = lineText[i];

    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
      i--;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) break;
      depth--;
      i--;
      continue;
    }
    if (depth > 0) {
      i--;
      continue;
    }
    if (/[\w$?."']/.test(ch)) {
      i--;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      // The space before a trailing lambda (`filter { … }`) is part of the
      // receiver; any other space ends the backward walk.
      if (lineText[i + 1] === '{') {
        i--;
        continue;
      }
      break;
    }
    break;
  }

  const receiver = lineText.slice(i + 1, dotIndex).trim();
  return receiver.length > 0 ? receiver : null;
}

// Ints, decimals, hex, binary: `if (3.14)` and `if (0xFF)` are invalid Kotlin.
const NUMERIC_LITERAL = /^-?(?:0[xXbB][\dA-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?)[LfF]?$/;

/**
 * Snippet body for `template` applied to `receiver`; null when refused.
 *
 * Indentation is RELATIVE, one level for the body and none for the closing
 * brace. VS Code re-indents every line after the first when it inserts a
 * multi-line SnippetString, adding the indentation of the insertion line.
 * Measured in a real editor: a snippet carrying absolute indentation comes
 * out indented twice.
 *
 * The matching rule on the consumer side: always insert through
 * `insertSnippet`, never through a plain `TextEdit`, which applies no
 * re-indentation at all and leaves the closing brace in column 0.
 */
export function expandPostfix(
  template: string,
  receiver: string,
): string | null {
  const numeric = NUMERIC_LITERAL.test(receiver);
  const inner = '    ';
  /** `head { body }` block, one level of relative indentation. */
  const block = (head: string, body: string) =>
    `${head} {\n${inner}${body}\n}`;

  switch (template as PostfixTemplate) {
    case 'let':
      return `${receiver}.let { $0 }`;
    case 'val':
      return `val \${1:value} = ${receiver}`;
    case 'if':
      if (numeric) return null;
      return block(`if (${receiver})`, '$0');
    case 'null':
      if (numeric) return null;
      return block(`if (${receiver} == null)`, '$0');
    case 'notnull':
      if (numeric) return null;
      return block(`if (${receiver} != null)`, '$0');
    case 'for':
      return block(`for (item in ${receiver})`, '$0');
    case 'when':
      return block(`when (${receiver})`, '$0');
    case 'try':
      return `try {\n${inner}${receiver}\n} catch (e: Exception) {\n${inner}$0\n}`;
    case 'not':
      if (numeric) return null;
      return `!${receiver}`;
    default:
      return null;
  }
}

export class PostfixCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('postfixCompletion', true)) return [];

    const line = document.lineAt(position.line).text;
    const typedTo = position.character;

    // Last '.' before the cursor (the filter text is typed after the dot).
    const dotIndex = line.lastIndexOf('.', typedTo - 1);
    if (dotIndex < 0) return [];
    if (isInsideCommentOrString(line, dotIndex)) return [];

    const receiver = extractReceiver(line, dotIndex);
    if (!receiver) return [];

    const receiverStart = dotIndex - receiver.length;
    const items: vscode.CompletionItem[] = [];

    for (const tmpl of POSTFIX_TEMPLATES) {
      const expanded = expandPostfix(tmpl, receiver);
      if (expanded === null) continue;

      const item = new vscode.CompletionItem(
        { label: tmpl, description: 'postfix' },
        vscode.CompletionItemKind.Snippet,
      );
      item.insertText = new vscode.SnippetString(expanded);
      item.range = new vscode.Range(position.line, receiverStart, position.line, typedTo);
      item.filterText = `${receiver}.${tmpl}`;
      item.detail = expanded.split('\n')[0];
      item.sortText = `zz_postfix_${tmpl}`; // after regular completions
      items.push(item);
    }
    return items;
  }
}
