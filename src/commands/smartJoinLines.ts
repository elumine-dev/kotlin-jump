import * as vscode from 'vscode';

/**
 * KJ-007: Smart join lines (Ctrl+Shift+J in IntelliJ): smart merge of the
 * next line. Special cases: string literal concatenation, consecutive `//`
 * comments, call chains. Otherwise, standard join.
 */

export interface JoinResult {
  joined: string;
  /** true when a special case was applied (not the plain space join). */
  special: boolean;
}

const STRING_CONCAT_END = /"\s*\+\s*$/;

export function smartJoin(currentLine: string, nextLine: string): JoinResult {
  const next = nextLine.trim();

  // 1. Literal concatenation: `"…" +` then `"…"` → a single literal.
  if (STRING_CONCAT_END.test(currentLine) && next.startsWith('"')) {
    return {
      joined: currentLine.replace(STRING_CONCAT_END, '') + next.slice(1),
      special: true,
    };
  }

  // 2. Consecutive // comments → a single comment.
  if (currentLine.trim().startsWith('//') && next.startsWith('//')) {
    return {
      joined: currentLine.trimEnd() + ' ' + next.replace(/^\/\/\s?/, ''),
      special: true,
    };
  }

  // 3. Call chain: the next line starts with `.` or `?.` → glued on.
  if (next.startsWith('.') || next.startsWith('?.')) {
    return { joined: currentLine.trimEnd() + next, special: true };
  }

  // 4. Fallback: standard join with a space.
  if (next.length === 0) return { joined: currentLine.trimEnd(), special: false };
  return { joined: currentLine.trimEnd() + ' ' + next, special: false };
}

export async function smartJoinLinesCommand(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document;
  const line = editor.selection.active.line;
  if (line >= doc.lineCount - 1) return;

  const current = doc.lineAt(line).text;
  const next = doc.lineAt(line + 1).text;
  const { joined } = smartJoin(current, next);

  await editor.edit(edit => {
    edit.replace(
      new vscode.Range(line, 0, line + 1, next.length),
      joined,
    );
  });
}

/**
 * The same gesture, discoverable from the lightbulb: the action is only
 * offered when the join would do something smart (special cases), so the
 * menu of every ordinary line stays clean.
 */
export class SmartJoinLinesProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const line = range.start.line;
    if (line >= document.lineCount - 1) return [];
    const { special } = smartJoin(document.lineAt(line).text, document.lineAt(line + 1).text);
    if (!special) return [];

    const action = new vscode.CodeAction(
      'Smart join lines',
      vscode.CodeActionKind.RefactorRewrite,
    );
    action.command = {
      command: 'kotlin-jump.smartJoinLines',
      title: action.title,
    };
    return [action];
  }
}
