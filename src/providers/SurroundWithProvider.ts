import * as vscode from 'vscode';

/**
 * KJ-006: Surround with… (Cmd+Alt+T in IntelliJ): wraps the selection in an
 * if / try-catch / let / run / apply / when template, with re-indentation.
 */

export interface SurroundTemplate {
  id: string;
  label: string;
}

export const SURROUND_TEMPLATES: SurroundTemplate[] = [
  { id: 'if', label: 'if { … }' },
  { id: 'tryCatch', label: 'try / catch' },
  { id: 'let', label: '.let { … }' },
  { id: 'run', label: 'run { … }' },
  { id: 'apply', label: '.apply { … }' },
  { id: 'when', label: 'when (…) { … }' },
];

const INDENT_UNIT = '    ';

/**
 * Re-indents the block one level, RELATIVE to column 0.
 *
 * Two traps measured in a real editor:
 *  - `getText(selection)` drops the leading indentation of the FIRST line
 *    when the selection starts after it, so that line looked less indented
 *    than the rest of the block. It is restored here before anything else.
 *  - VS Code re-indents every line after the first when inserting a
 *    multi-line SnippetString. Emitting absolute indentation here produced
 *    a block indented twice.
 */
function reindent(selection: string, baseIndent: string): string {
  const lines = selection.split('\n');
  if (lines.length > 1 && lines[0].length > 0 && !/^\s/.test(lines[0])) {
    lines[0] = baseIndent + lines[0];
  }
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  const common = nonEmpty.length > 0
    ? Math.min(...nonEmpty.map(l => l.length - l.trimStart().length))
    : 0;
  return lines
    .map(l => (l.trim().length === 0 ? '' : INDENT_UNIT + l.slice(common)))
    .join('\n');
}

export function surroundSelection(id: string, selection: string, baseIndent: string): string {
  const singleLine = !selection.includes('\n');

  // Expression templates: on an intra-line selection, stay an expression.
  if (singleLine) {
    const expr = selection.trim();
    switch (id) {
      case 'let':
        return `${expr}.let { $0 }`;
      case 'apply':
        return `${expr}.apply { $0 }`;
      case 'run':
        return `run { ${expr} }`;
      case 'if':
        return `if ($1) {\n${INDENT_UNIT}${expr}\n}`;
      case 'when':
        // The selected expression becomes the SUBJECT of the when (IntelliJ
        // semantics); putting it in the body produced invalid Kotlin.
        return `when (${expr}) {\n${INDENT_UNIT}$0\n}`;
      case 'tryCatch':
        return (
          `try {\n${INDENT_UNIT}${expr}\n} ` +
          `catch (e: Exception) {\n${INDENT_UNIT}$0\n}`
        );
      default:
        return selection;
    }
  }

  const body = reindent(selection, baseIndent);
  switch (id) {
    case 'if':
      return `if ($1) {\n${body}\n}`;
    case 'when':
      return `when ($1) {\n${body}\n}`;
    case 'run':
      return `run {\n${body}\n}`;
    case 'let':
      return `let {\n${body}\n}`;
    case 'apply':
      return `apply {\n${body}\n}`;
    case 'tryCatch':
      return (
        `try {\n${body}\n} catch (e: Exception) {\n` +
        `${INDENT_UNIT}$0\n}`
      );
    default:
      return selection;
  }
}

export class SurroundWithProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('surroundWith', true)) return [];
    if (range.isEmpty) return [];

    return SURROUND_TEMPLATES.map(t => {
      const action = new vscode.CodeAction(
        `Surround with ${t.label}`,
        vscode.CodeActionKind.RefactorRewrite,
      );
      action.command = {
        command: 'kotlin-jump.surroundWith.apply',
        title: action.title,
        arguments: [document.uri, range, t.id],
      };
      return action;
    });
  }
}

/** Command: applies the template via SnippetString (live placeholders). */
export async function applySurround(
  editor: vscode.TextEditor,
  templateId: string,
): Promise<void> {
  let selection: vscode.Selection = editor.selection;
  // Empty selection → extend to the whole current line.
  if (selection.isEmpty) {
    const line = editor.document.lineAt(selection.start.line);
    selection = new vscode.Selection(
      line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex),
      line.range.end,
    );
  }
  // A full-line selection often ends at column 0 of the NEXT line; pull the
  // end back so the trailing newline does not become an empty body line.
  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    const prev = editor.document.lineAt(selection.end.line - 1);
    selection = new vscode.Selection(selection.start, prev.range.end);
  }
  // A selection that starts inside the leading whitespace (column 0 of an
  // indented line, typical of line selections) would make insertSnippet
  // plant the template at that column: `try {` lands flush left and VS Code
  // then normalises the whole block to column 0. Anchor the start at the
  // first non-blank character so the snippet inherits the real indentation.
  const startLine = editor.document.lineAt(selection.start.line);
  if (selection.start.character < startLine.firstNonWhitespaceCharacterIndex) {
    selection = new vscode.Selection(
      selection.start.with(undefined, startLine.firstNonWhitespaceCharacterIndex),
      selection.end,
    );
  }
  const text = editor.document.getText(selection);
  const baseIndent = ' '.repeat(
    editor.document.lineAt(selection.start.line).firstNonWhitespaceCharacterIndex,
  );
  const snippet = surroundSelection(templateId, text, baseIndent);
  await editor.insertSnippet(new vscode.SnippetString(snippet), selection);
}

/** QuickPick for the keyboard command (Cmd+Alt+T). */
export async function surroundWithQuickPick(editor: vscode.TextEditor): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    SURROUND_TEMPLATES.map(t => ({ label: t.label, id: t.id })),
    { placeHolder: 'Surround with…' },
  );
  if (!pick) return;
  await applySurround(editor, pick.id);
}
