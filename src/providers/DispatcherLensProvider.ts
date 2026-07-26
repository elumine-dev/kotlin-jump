import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-019: Dispatcher Lens, annotates withContext/launch/async/flowOn blocks
 * with their dispatcher (IO / Main / Default) and quietly flags the suspicious
 * ones: View access on IO, network/DB call on Main. An injected dispatcher
 * (a variable) produces NO scope at all, on purpose.
 */

export type DispatcherName = 'IO' | 'Main' | 'Default';

export interface DispatcherScope {
  dispatcher: DispatcherName;
  startLine: number;
  endLine: number;
  /** Character index of the opening brace, breaks ties between scopes opened
   *  on the same line (the innermost one has the largest index). */
  startIndex?: number;
}

export interface DispatcherHint {
  line: number;
  kind: 'view-in-io' | 'blocking-in-main';
}

export interface DispatcherAnalysis {
  scopes: DispatcherScope[];
  hints: DispatcherHint[];
}

const VIEW_ACCESS_RE = /\b(binding|view\w*)\s*\.\s*\w/;
const BLOCKING_RE = /\b(api\w*|dao\w*|repository|retrofit|client|db)\s*\.\s*\w|\.fetch\w*\s*\(/i;

function matchBalanced(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function analyzeDispatcherScopes(text: string): DispatcherAnalysis {
  const scopes: DispatcherScope[] = [];
  const lineOf = (idx: number) => (text.slice(0, idx).match(/\n/g) ?? []).length;

  // withContext / launch / async with an explicit Dispatchers.X.
  const openerRe = /\b(withContext|launch|async)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(text)) !== null) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchBalanced(text, parenOpen, '(', ')');
    if (parenClose < 0) continue;
    const arg = text.slice(parenOpen + 1, parenClose);
    const disp = /Dispatchers\.(IO|Main|Default)\b/.exec(arg);

    let j = parenClose + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== '{') continue;
    const blockEnd = matchBalanced(text, j, '{', '}');
    if (blockEnd < 0) continue;

    if (disp) {
      scopes.push({
        dispatcher: disp[1] as DispatcherName,
        startLine: lineOf(j),
        endLine: lineOf(blockEnd),
        startIndex: j,
      });
    }
    // injected dispatcher: no scope, on purpose.
  }

  // flow { … }.flowOn(Dispatchers.X): the scope covers the flow block.
  const flowRe = /\bflow\s*\{/g;
  while ((m = flowRe.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const end = matchBalanced(text, open, '{', '}');
    if (end < 0) continue;
    const after = /^\s*\.flowOn\(\s*Dispatchers\.(IO|Main|Default)\b/.exec(text.slice(end + 1));
    if (!after) continue;
    scopes.push({
      dispatcher: after[1] as DispatcherName,
      startLine: lineOf(open),
      endLine: lineOf(end),
      startIndex: open,
    });
  }

  // Hints: effective dispatcher = innermost scope containing the line.
  const hints: DispatcherHint[] = [];
  const innermostAt = (line: number): DispatcherName | undefined =>
    scopes
      .filter(s => s.startLine <= line && line <= s.endLine)
      .sort((a, b) => (b.startIndex ?? b.startLine) - (a.startIndex ?? a.startLine))[0]
      ?.dispatcher;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const disp = innermostAt(i);
    if (!disp) continue;
    if ((disp === 'IO' || disp === 'Default') && VIEW_ACCESS_RE.test(lines[i])) {
      hints.push({ line: i, kind: 'view-in-io' });
    }
    if (disp === 'Main' && BLOCKING_RE.test(lines[i])) {
      hints.push({ line: i, kind: 'blocking-in-main' });
    }
  }
  return { scopes, hints };
}

export class DispatcherLensProvider implements vscode.Disposable {
  private readonly _badge: Record<DispatcherName, vscode.TextEditorDecorationType> = {
    IO: this._makeDecoration('IO'),
    Main: this._makeDecoration('Main'),
    Default: this._makeDecoration('Default'),
  };
  private readonly _hint = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 2em',
      color: new vscode.ThemeColor('editorWarning.foreground'),
    },
  });
  private readonly _subs: vscode.Disposable[];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  private _makeDecoration(label: DispatcherName): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      before: {
        contentText: label,
        margin: '0 6px 0 0',
        color: new vscode.ThemeColor('editorLineNumber.foreground'),
      },
      isWholeLine: false,
    });
  }

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          if (this._timer) clearTimeout(this._timer);
          this._timer = setTimeout(() => this._refresh(), 500);
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.dispatcherLens')) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('dispatcherLens', true);
    const clear = () => {
      for (const d of Object.values(this._badge)) editor.setDecorations(d, []);
      editor.setDecorations(this._hint, []);
    };
    if (!enabled) return clear();

    const text = editor.document.getText();
    if (!/Dispatchers\.(IO|Main|Default)/.test(text)) return clear();

    const { scopes, hints } = analyzeDispatcherScopes(text);
    // Badge on the opening line of each scope only, to stay discreet.
    for (const name of ['IO', 'Main', 'Default'] as DispatcherName[]) {
      editor.setDecorations(
        this._badge[name],
        scopes.filter(s => s.dispatcher === name).map(s => new vscode.Range(s.startLine, 0, s.startLine, 0)),
      );
    }
    editor.setDecorations(
      this._hint,
      hints.map(h => ({
        range: new vscode.Range(h.line, editor.document.lineAt(h.line).text.length, h.line, editor.document.lineAt(h.line).text.length),
        renderOptions: {
          after: {
            contentText:
              h.kind === 'view-in-io' ? '⚠ View touched off Main' : '⚠ blocking call on Main',
          },
        },
      })),
    );
    reportDecorations('dispatcherLens', scopes.length + hints.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    for (const d of Object.values(this._badge)) d.dispose();
    this._hint.dispose();
    for (const s of this._subs) s.dispose();
  }
}
