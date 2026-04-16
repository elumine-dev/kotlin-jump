import * as vscode from 'vscode';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';

export class NullAssertionProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private _editor:     vscode.TextEditor | undefined;
  private _lineDecos = new Map<number, vscode.DecorationOptions[]>();
  private _rawState:  boolean[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._decorType = vscode.window.createTextEditorDecorationType({
      light: { color: '#B45309', fontWeight: 'bold' },  // amber-700, readable on white
      dark:  { color: '#FCD34D', fontWeight: 'bold' },  // amber-300, readable on dark backgrounds
    });

    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        this._editor = e;
        if (e) this._fullScan(e);
        else { this._lineDecos.clear(); this._rawState = []; }
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this._editor && e.document === this._editor.document)
          this._applyChanges(e);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.nullAssertionHighlight'))
          this.invalidateAll();
      }),
    ];

    this.invalidateAll();
  }

  invalidateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this._editor = editor;
      this._fullScan(editor);
    }
  }

  // ── Layer 1: raw-string oracle ─────────────────────────────────────────────
  private _buildRawState(doc: vscode.TextDocument): void {
    this._rawState = new Array(doc.lineCount).fill(false);
    let inRaw = false;
    for (let i = 0; i < doc.lineCount; i++) {
      this._rawState[i] = inRaw;
      if (countTripleQuotes(doc.lineAt(i).text) % 2 !== 0) inRaw = !inRaw;
    }
  }

  // ── Layer 2: per-line rescan ───────────────────────────────────────────────
  private _rescanLine(lineNum: number, text: string): void {
    if (this._rawState[lineNum]) { this._lineDecos.delete(lineNum); return; }
    const decos: vscode.DecorationOptions[] = [];
    let idx = 0;
    while ((idx = text.indexOf('!!', idx)) !== -1) {
      if (!isInsideCommentOrString(text, idx))
        decos.push({ range: new vscode.Range(lineNum, idx, lineNum, idx + 2) });
      idx += 2;
    }
    decos.length ? this._lineDecos.set(lineNum, decos) : this._lineDecos.delete(lineNum);
  }

  // ── Line-index shift after Enter / Backspace ───────────────────────────────
  private _shiftDecos(fromLine: number, delta: number): void {
    const next = new Map<number, vscode.DecorationOptions[]>();
    for (const [line, decos] of this._lineDecos) {
      if (line < fromLine)               next.set(line, decos);
      else if (line + delta >= fromLine) next.set(line + delta, decos);
      // else: line deleted — drop
    }
    this._lineDecos = next;
  }

  // ── Layer 3: 16ms render throttle ─────────────────────────────────────────
  private _scheduleFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = undefined;
      if (this._editor) this._flush(this._editor);
    }, 16);
  }

  private _flush(editor: vscode.TextEditor): void {
    const all: vscode.DecorationOptions[] = [];
    for (const k of [...this._lineDecos.keys()].sort((a, b) => a - b))
      all.push(...this._lineDecos.get(k)!);
    editor.setDecorations(this._decorType, all);
  }

  // ── Incremental orchestrator (per keystroke) ───────────────────────────────
  private _applyChanges(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;

    // Sort bottom→top so line-number shifts don't cascade
    const sorted = [...e.contentChanges].sort(
      (a, b) => b.range.start.line - a.range.start.line,
    );

    // Detect whether any """ appeared in the changed text or the affected lines
    let needsRawRebuild = false;
    for (const change of sorted) {
      if (change.text.includes('"""')) { needsRawRebuild = true; break; }
      for (let i = change.range.start.line;
           i <= Math.min(change.range.end.line, doc.lineCount - 1); i++) {
        if (doc.lineAt(i).text.includes('"""')) { needsRawRebuild = true; break; }
      }
      if (needsRawRebuild) break;
    }

    if (needsRawRebuild) {
      // Raw-string boundaries changed — full rescan (happens rarely, e.g. on """ typing)
      this._lineDecos.clear();
      this._buildRawState(doc);
      for (let i = 0; i < doc.lineCount; i++)
        this._rescanLine(i, doc.lineAt(i).text);
      this._scheduleFlush();
      return;
    }

    // Normal incremental path (no """ involved)
    for (const change of sorted) {
      const addedLines   = (change.text.match(/\n/g) ?? []).length;
      const removedLines = change.range.end.line - change.range.start.line;
      const delta        = addedLines - removedLines;
      if (delta !== 0)
        this._shiftDecos(change.range.start.line + 1, delta);

      const endLine = change.range.start.line + addedLines;
      for (let i = change.range.start.line; i <= endLine && i < doc.lineCount; i++)
        this._rescanLine(i, doc.lineAt(i).text);
    }

    this._scheduleFlush();
  }

  // ── Full scan (on file open / editor switch) ───────────────────────────────
  private _fullScan(editor: vscode.TextEditor): void {
    const lang = editor.document.languageId;
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('nullAssertionHighlight', true);
    if ((lang !== 'kotlin' && lang !== 'java') || !enabled) {
      this._lineDecos.clear();
      editor.setDecorations(this._decorType, []);
      return;
    }
    this._lineDecos.clear();
    this._buildRawState(editor.document);
    for (let i = 0; i < editor.document.lineCount; i++)
      this._rescanLine(i, editor.document.lineAt(i).text);
    this._flush(editor); // immediate — no throttle on open
  }

  dispose(): void {
    clearTimeout(this._flushTimer);
    this._lineDecos.clear();
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}
