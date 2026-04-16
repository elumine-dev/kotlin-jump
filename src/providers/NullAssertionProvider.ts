import * as vscode from 'vscode';
import { isInsideCommentOrString } from '../util/textUtils';

export class NullAssertionProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private readonly _subscriptions: vscode.Disposable[];

  constructor() {
    // Use explicit light/dark colors instead of ThemeColor — ThemeColor('editorWarning.foreground')
    // is defined for diagnostic squiggles and may not resolve reliably as a text color decoration,
    // especially when semantic highlighting is active.
    this._decorType = vscode.window.createTextEditorDecorationType({
      light: { color: '#B45309', fontWeight: 'bold' },  // amber-700, readable on white
      dark:  { color: '#FCD34D', fontWeight: 'bold' },  // amber-300, readable on dark backgrounds
    });

    this._subscriptions = [
      // Update when switching files
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e);
        else this._clear();
      }),
      // Update when editors become visible (split view, new tabs)
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.invalidateAll();
      }),
      // Update on every keystroke
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) this._update(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.nullAssertionHighlight')) {
          this.invalidateAll();
        }
      }),
    ];

    // Always call invalidateAll — more robust than checking activeTextEditor alone,
    // because activeTextEditor can be undefined at activation time even with a file open.
    this.invalidateAll();
  }

  invalidateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this._update(editor);
    }
  }

  private _clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this._decorType, []);
    }
  }

  private _update(editor: vscode.TextEditor): void {
    const lang = editor.document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') {
      editor.setDecorations(this._decorType, []);
      return;
    }

    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('nullAssertionHighlight', true);
    if (!enabled) {
      editor.setDecorations(this._decorType, []);
      return;
    }

    const opts: vscode.DecorationOptions[] = [];
    let inRawString = false;

    for (let i = 0; i < editor.document.lineCount; i++) {
      const text = editor.document.lineAt(i).text;

      const tripleCount = countTripleQuotes(text);
      if (inRawString) {
        if (tripleCount % 2 !== 0) inRawString = false;
        continue;
      }
      if (tripleCount % 2 !== 0) {
        inRawString = true;
        continue;
      }

      let idx = 0;
      while ((idx = text.indexOf('!!', idx)) !== -1) {
        if (!isInsideCommentOrString(text, idx)) {
          opts.push({ range: new vscode.Range(i, idx, i, idx + 2) });
        }
        idx += 2;
      }
    }

    editor.setDecorations(this._decorType, opts);
  }

  dispose(): void {
    this._decorType.dispose();
    for (const s of this._subscriptions) s.dispose();
  }
}

function countTripleQuotes(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}
