import * as vscode from 'vscode';
import { isInsideCommentOrString } from '../util/textUtils';

// Matches 0xAARRGGBB hex literals (8 hex digits, Android ARGB format).
const HEX_0X_RE = /\b0x([0-9A-Fa-f]{8})\b/g;

// Matches "#RGB", "#ARGB", "#RRGGBB", "#AARRGGBB" string literals.
const HEX_STR_RE = /"(#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3}))"/g;

export class HexColorFoldingProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private readonly _subscriptions: vscode.Disposable[];
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // No shared style — color is set per-decoration via renderOptions.before.color
    this._decorType = vscode.window.createTextEditorDecorationType({});
    this._subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e);
        else this._clear();
      }),
      // Debounced to avoid O(n) scan on each keystroke
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document !== e.document) return;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._update(editor), 100);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.hexColorSwatch')) {
          this.invalidateAll();
        }
      }),
    ];
    if (vscode.window.activeTextEditor) this._update(vscode.window.activeTextEditor);
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
      .get<boolean>('hexColorSwatch', true);
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

      // 0xAARRGGBB format — skip if inside string/comment
      HEX_0X_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HEX_0X_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const cssColor = argbHexToCSS(m[1]);
        opts.push(swatchDecoration(i, m.index, cssColor));
      }

      // "#RRGGBB" / "#AARRGGBB" string literals
      HEX_STR_RE.lastIndex = 0;
      while ((m = HEX_STR_RE.exec(text))) {
        // m.index is the opening quote — skip if inside a // or /* */ comment.
        // (isInsideCommentOrString is not used here: it treats the opening quote
        // itself as "inside a string", causing false-negatives for valid literals.)
        if (isInsideComment(text, m.index)) continue;
        const cssColor = cssHexToCSS(m[1]);
        opts.push(swatchDecoration(i, m.index, cssColor));
      }
    }

    editor.setDecorations(this._decorType, opts);
  }

  dispose(): void {
    clearTimeout(this._debounceTimer);
    this._decorType.dispose();
    for (const s of this._subscriptions) s.dispose();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function swatchDecoration(
  line: number,
  col: number,
  cssColor: string,
): vscode.DecorationOptions {
  return {
    range: new vscode.Range(line, col, line, col),
    renderOptions: {
      before: {
        contentText: '■',
        color: cssColor,
        margin: '0 4px 0 0',
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

// Converts Android CSS hex string (#RGB, #ARGB, #RRGGBB, #AARRGGBB) → CSS color
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

// Returns true when `pos` is inside a // or /* ... */ comment region.
// Unlike isInsideCommentOrString, this function considers string content as
// opaque (so "//" inside a string is NOT a comment), and returns false when
// pos is the opening quote of a string literal.
function isInsideComment(line: string, pos: number): boolean {
  let inStr: string | false = false;
  let i = 0;
  while (i < line.length) {
    if (inStr) {
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === inStr) inStr = false;
      i++;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx === -1) return pos >= i;
      if (pos >= i && pos < closeIdx + 2) return true;
      i = closeIdx + 2;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
    }
    i++;
  }
  return false;
}

function countTripleQuotes(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}
