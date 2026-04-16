import * as vscode from 'vscode';
import { isInsideCommentOrString, isInsideComment } from '../util/textUtils';

// 0xAARRGGBB hex literals (8 hex digits, Android ARGB format).
const HEX_0X_RE = /\b0x([0-9A-Fa-f]{8})\b/g;

// "#RGB", "#ARGB", "#RRGGBB", "#AARRGGBB" string literals (with surrounding quotes).
const HEX_STR_RE = /"(#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3}))"/g;

export class HexColorDocumentColorProvider implements vscode.DocumentColorProvider {
  provideDocumentColors(
    document: vscode.TextDocument,
  ): vscode.ColorInformation[] {
    const result: vscode.ColorInformation[] = [];
    let inRawString = false;

    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;

      const tripleCount = countTripleQuotes(text);
      if (inRawString) {
        if (tripleCount % 2 !== 0) inRawString = false;
        continue;
      }
      if (tripleCount % 2 !== 0) {
        inRawString = true;
        continue;
      }

      // 0xAARRGGBB — range covers the full literal (e.g. 0xFF7F52FF)
      HEX_0X_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HEX_0X_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const color = argbHexToColor(m[1]);
        const range = new vscode.Range(i, m.index, i, m.index + m[0].length);
        result.push(new vscode.ColorInformation(range, color));
      }

      // "#RGB" / "#ARGB" / "#RRGGBB" / "#AARRGGBB"
      // Range covers only the hex value (e.g. #5731c0), NOT the surrounding quotes,
      // so that provideColorPresentations can read and replace just the hex portion.
      HEX_STR_RE.lastIndex = 0;
      while ((m = HEX_STR_RE.exec(text))) {
        if (isInsideComment(text, m.index)) continue;
        const hexValue = m[1]; // e.g. "#5731c0"
        const hexStart = m.index + 1; // skip the opening quote
        const color = cssHexToColor(hexValue);
        const range = new vscode.Range(i, hexStart, i, hexStart + hexValue.length);
        result.push(new vscode.ColorInformation(range, color));
      }
    }

    return result;
  }

  provideColorPresentations(
    color: vscode.Color,
    context: { document: vscode.TextDocument; range: vscode.Range },
  ): vscode.ColorPresentation[] {
    const original = context.document.getText(context.range);

    let label: string;
    if (original.startsWith('0x') || original.startsWith('0X')) {
      label = `0x${colorToArgbHex(color)}`;
    } else {
      // CSS hex format — preserve the digit count of the original
      const digits = original.startsWith('#') ? original.length - 1 : original.length;
      if (digits === 4 || digits === 8) {
        // Had alpha (#ARGB or #AARRGGBB) → keep ARGB format
        label = `#${colorToArgbHex(color)}`;
      } else {
        // Opaque format (#RGB or #RRGGBB) → keep opaque RRGGBB
        label = `#${colorToRgbHex(color)}`;
      }
    }

    const presentation = new vscode.ColorPresentation(label);
    presentation.textEdit = new vscode.TextEdit(context.range, label);
    return [presentation];
  }
}

// ── Color conversion helpers ──────────────────────────────────────────────────

// 8-digit ARGB hex string → vscode.Color (channels 0.0–1.0)
function argbHexToColor(hex8: string): vscode.Color {
  const aa = parseInt(hex8.slice(0, 2), 16) / 255;
  const rr = parseInt(hex8.slice(2, 4), 16) / 255;
  const gg = parseInt(hex8.slice(4, 6), 16) / 255;
  const bb = parseInt(hex8.slice(6, 8), 16) / 255;
  return new vscode.Color(rr, gg, bb, aa);
}

// Android/CSS hex string (#RGB, #ARGB, #RRGGBB, #AARRGGBB) → vscode.Color
function cssHexToColor(hex: string): vscode.Color {
  const h = hex.slice(1); // strip #
  switch (h.length) {
    case 3: { // #RGB → R=h[0]*17, G=h[1]*17, B=h[2]*17, A=1
      const r = parseInt(h[0] + h[0], 16) / 255;
      const g = parseInt(h[1] + h[1], 16) / 255;
      const b = parseInt(h[2] + h[2], 16) / 255;
      return new vscode.Color(r, g, b, 1.0);
    }
    case 4: { // #ARGB (Android)
      const a = parseInt(h[0] + h[0], 16) / 255;
      const r = parseInt(h[1] + h[1], 16) / 255;
      const g = parseInt(h[2] + h[2], 16) / 255;
      const b = parseInt(h[3] + h[3], 16) / 255;
      return new vscode.Color(r, g, b, a);
    }
    case 6: { // #RRGGBB
      const r = parseInt(h.slice(0, 2), 16) / 255;
      const g = parseInt(h.slice(2, 4), 16) / 255;
      const b = parseInt(h.slice(4, 6), 16) / 255;
      return new vscode.Color(r, g, b, 1.0);
    }
    case 8: { // #AARRGGBB (Android)
      return argbHexToColor(h);
    }
    default:
      return new vscode.Color(0, 0, 0, 1.0);
  }
}

// vscode.Color → 6-digit uppercase RGB hex (no prefix, no alpha)
function colorToRgbHex(c: vscode.Color): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

// vscode.Color → 8-digit uppercase ARGB hex (no prefix, Android byte order)
function colorToArgbHex(c: vscode.Color): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${h(c.alpha)}${h(c.red)}${h(c.green)}${h(c.blue)}`;
}

function countTripleQuotes(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}
