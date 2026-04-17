import * as vscode from 'vscode';
import { isInsideCommentOrString, isInsideComment, countTripleQuotes } from '../util/textUtils';

// Matches 0xAARRGGBB hex literals (8 hex digits, Android ARGB format).
const HEX_0X_RE  = /\b0x([0-9A-Fa-f]{8})\b/g;

// Matches "#RGB", "#ARGB", "#RRGGBB", "#AARRGGBB" string literals.
const HEX_STR_RE = /"(#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3}))"/g;

export class HexColorFoldingProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private _editor:     vscode.TextEditor | undefined;
  private _lineDecos = new Map<number, vscode.DecorationOptions[]>();
  private _rawState:  boolean[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _subs: vscode.Disposable[];

  constructor() {
    // No shared style — color is set per-decoration via renderOptions.before.color
    this._decorType = vscode.window.createTextEditorDecorationType({});

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
        if (e.affectsConfiguration('kotlinJump.hexColorSwatch'))
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

    HEX_0X_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEX_0X_RE.exec(text)) !== null) {
      if (!isInsideCommentOrString(text, m.index))
        decos.push(swatchDecoration(lineNum, m.index, argbHexToCSS(m[1])));
    }

    HEX_STR_RE.lastIndex = 0;
    while ((m = HEX_STR_RE.exec(text)) !== null) {
      // m.index is the opening quote — check only for comment context
      // (isInsideCommentOrString would wrongly return true for the opening quote itself)
      if (!isInsideComment(text, m.index))
        decos.push(swatchDecoration(lineNum, m.index, cssHexToCSS(m[1])));
    }

    decos.length ? this._lineDecos.set(lineNum, decos) : this._lineDecos.delete(lineNum);
  }

  // ── Line-index shift after Enter / Backspace ───────────────────────────────
  private _shiftDecos(fromLine: number, delta: number): void {
    const next = new Map<number, vscode.DecorationOptions[]>();
    for (const [line, decos] of this._lineDecos) {
      if (line < fromLine)               next.set(line, decos);
      else if (line + delta >= fromLine) next.set(line + delta, decos);
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

    const sorted = [...e.contentChanges].sort(
      (a, b) => b.range.start.line - a.range.start.line,
    );

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
      .get<boolean>('hexColorSwatch', true);
    if ((lang !== 'kotlin' && lang !== 'java') || !enabled) {
      this._lineDecos.clear();
      editor.setDecorations(this._decorType, []);
      return;
    }
    this._lineDecos.clear();
    this._buildRawState(editor.document);
    for (let i = 0; i < editor.document.lineCount; i++)
      this._rescanLine(i, editor.document.lineAt(i).text);
    this._flush(editor);
  }

  dispose(): void {
    clearTimeout(this._flushTimer);
    this._lineDecos.clear();
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function swatchDecoration(
  line: number,
  col: number,
  cssColor: string,
): vscode.DecorationOptions {
  return {
    range: new vscode.Range(line, col, line, col),
    renderOptions: {
      before: {
        contentText: '\u00A0',
        backgroundColor: cssColor,
        margin: '0 4px 0 0',
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.foreground'),
        textDecoration: 'none; display: inline-block; width: 0.65em; height: 0.65em; vertical-align: middle;',
      },
    },
  };
}

// Converts 8-digit hex ARGB (Android) → CSS rgba(r,g,b,a)
function argbHexToCSS(hex8: string): string {
  const aa = parseInt(hex8.slice(0, 2), 16);
  const rr = parseInt(hex8.slice(2, 4), 16);
  const gg = parseInt(hex8.slice(4, 6), 16);
  const bb = parseInt(hex8.slice(6, 8), 16);
  return `rgba(${rr},${gg},${bb},${(aa / 255).toFixed(2)})`;
}

// Converts CSS hex string (#RGB, #ARGB, #RRGGBB, #AARRGGBB) → CSS color
function cssHexToCSS(hex: string): string {
  const h = hex.slice(1); // strip #
  switch (h.length) {
    case 3: {
      // #RGB → #RRGGBB
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    case 4: {
      // #ARGB → rgba(RR, GG, BB, AA/255)
      const a = parseInt(h[0] + h[0], 16);
      const r = parseInt(h[1] + h[1], 16);
      const g = parseInt(h[2] + h[2], 16);
      const b = parseInt(h[3] + h[3], 16);
      return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
    }
    case 6: {
      return hex; // already valid CSS #RRGGBB
    }
    case 8: {
      // #AARRGGBB (Android) → rgba(RR, GG, BB, AA/255)
      return argbHexToCSS(h);
    }
    default:
      return hex;
  }
}
