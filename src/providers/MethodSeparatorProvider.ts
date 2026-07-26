import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-011: method separator line (IntelliJ "Show method separators").
 * A thin rule above every top-level member of a class (functions, companion,
 * nested classes), except the first one. Never between consecutive simple
 * properties, never inside bodies.
 */

const MEMBER_RE =
  /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|override|open|abstract|final|inline|suspend|operator|infix|tailrec|external|actual|expect|data|inner|sealed|enum|annotation)\s+)*(fun|class|object|interface|companion\s+object|constructor|init)\b/;

/** 0-based lines above which a rule is drawn. */
export function computeSeparatorLines(text: string): number[] {
  const lines = text.split('\n');
  const separators: number[] = [];

  let depth = 0;
  let classDepth = -1;   // brace depth of the enclosing class body
  let membersSeen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Top-level member of the class body (depth === classDepth + 1)
    if (classDepth >= 0 && depth === classDepth + 1 && MEMBER_RE.test(line)) {
      // a nested class / companion counts as a member, but we do not descend
      // into its body to mark its own members (classDepth stays that of the
      // outer class: its members sit at depth+2 and are ignored).
      if (membersSeen > 0) separators.push(attachedBlockStart(lines, i));
      membersSeen++;
    }

    // Detect entering the body of a file-level class.
    if (classDepth < 0 && /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|abstract|open|final|sealed|data|enum|annotation)\s+)*(?:class|object|interface)\b/.test(line) && line.includes('{')) {
      classDepth = depth;
    }

    // Update the brace depth (approximation that ignores strings, good enough
    // for formatted code: braces inside strings are rare on declaration
    // lines).
    for (const ch of trimmed) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (classDepth >= 0 && depth <= classDepth) {
          classDepth = -1;
          membersSeen = 0;
        }
      }
    }
  }
  return separators;
}

/** The rule goes ABOVE the comments/KDoc/annotations attached to the member
 *  (like IntelliJ), never between a comment and its function. */
function attachedBlockStart(lines: string[], memberLine: number): number {
  let top = memberLine;
  for (let j = memberLine - 1; j >= 0; j--) {
    if (/^\s*(\/\/|\/\*|\*|@)/.test(lines[j])) top = j;
    else break;
  }
  return top;
}

export class MethodSeparatorProvider implements vscode.Disposable {
  private readonly _decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '1px 0 0 0',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('editorIndentGuide.background1'),
  });
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidSaveTextDocument(() => this._refresh()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.methodSeparators')) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('methodSeparators', true);
    if (!enabled) {
      editor.setDecorations(this._decoration, []);
      return;
    }

    const ranges = computeSeparatorLines(editor.document.getText()).map(
      l => new vscode.Range(l, 0, l, 0),
    );
    editor.setDecorations(this._decoration, ranges);
    reportDecorations('methodSeparators', ranges.length);
  }

  dispose(): void {
    this._decoration.dispose();
    for (const s of this._subs) s.dispose();
  }
}
