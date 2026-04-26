import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';

const R_STRING_RE  = /\bR\.string\.([A-Za-z_]\w*)\b/g;
const R_PLURALS_RE = /\bR\.plurals\.([A-Za-z_]\w*)\b/g;
const R_ARRAY_RE   = /\bR\.array\.([A-Za-z_]\w*)\b/g;

// Matches printf-style specifiers: %s, %d, %1$s, %.2f, etc.
const FMT_RE = /%((\d+)\$)?[-+0 #]*\d*(?:\.\d+)?([sdfeoxXcb%])/g;

export class StringResourceHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: StringResourceIndex) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return;

    const lineText = document.lineAt(position.line).text;

    return (
      this._tryString(lineText, position) ??
      this._tryPlurals(lineText, position) ??
      this._tryArray(lineText, position)
    );
  }

  private _tryString(
    lineText: string,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    R_STRING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_STRING_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const key   = m[1];
      const entry = this.index.getValue(key);
      if (!entry) return;

      const md = new vscode.MarkdownString();
      md.appendCodeblock(entry.value, 'text');
      appendFormatHint(md, entry.value);
      appendSourceLine(md, key, entry);
      appendLocaleGrid(md, key, this.index);

      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }
  }

  private _tryPlurals(
    lineText: string,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    R_PLURALS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_PLURALS_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const key   = m[1];
      const entry = this.index.getPluralsValue(key);
      if (!entry) return;

      const md = new vscode.MarkdownString();
      const quantity = entry.chosenQuantity ?? 'other';
      md.appendMarkdown(`**plural** (quantity=${quantity})\n\n`);
      md.appendCodeblock(entry.value, 'text');
      appendFormatHint(md, entry.value);
      if (entry.quantities && !entry.quantities.has('other')) {
        md.appendMarkdown(
          '\n\n*Note:* no `other` quantity defined — Android requires it as a fallback.',
        );
      }
      appendSourceLine(md, key, entry);

      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }
  }

  private _tryArray(
    lineText: string,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    R_ARRAY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_ARRAY_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const key   = m[1];
      const entry = this.index.getArrayValue(key);
      if (!entry) return;

      const md = new vscode.MarkdownString();
      md.appendMarkdown('**string-array**\n\n');
      md.appendCodeblock(entry.value, 'text');
      appendSourceLine(md, key, entry);

      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendSourceLine(
  md: vscode.MarkdownString,
  key: string,
  entry: { uri: { toString(): string }; line: number },
): void {
  const uriStr  = entry.uri.toString();
  const resIdx  = uriStr.lastIndexOf('/res/');
  const displayPath = resIdx >= 0
    ? uriStr.slice(resIdx + 1)
    : uriStr.split('/').slice(-2).join('/');
  md.appendMarkdown(`\n\`${key}\` — ${displayPath}:${entry.line + 1}`);
}

// Feature 4 — annotate format specifiers if any are found in the value.
function appendFormatHint(md: vscode.MarkdownString, value: string): void {
  FMT_RE.lastIndex = 0;
  const specs: string[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = FMT_RE.exec(value))) {
    const conv = fm[3];
    if (conv === '%') continue; // escaped %%
    const argNum = fm[2] ? `arg${fm[2]} ` : '';
    specs.push(`\`${fm[0]}\` ${argNum}→ ${conversionName(conv)}`);
  }
  if (specs.length === 0) return;
  md.appendMarkdown(`\n\n*Format:* ${specs.join(' · ')}`);
}

function conversionName(c: string): string {
  switch (c) {
    case 's': return 'String';
    case 'd': return 'Int';
    case 'f': case 'e': return 'Float';
    case 'x': case 'X': case 'o': return 'Int (hex/octal)';
    case 'c': return 'Char';
    case 'b': return 'Boolean';
    default:  return c;
  }
}

// Feature 6 — show a locale grid if more than one locale exists.
function appendLocaleGrid(
  md: vscode.MarkdownString,
  key: string,
  index: StringResourceIndex,
): void {
  const knownLocales = index.getKnownLocales();
  if (knownLocales.length <= 1) return;

  const localeEntries = index.getLocaleEntries(key);
  const rows = knownLocales.map(locale => {
    const present = localeEntries.has(locale);
    const label   = locale === 'values' ? 'default' : locale.replace('values-', '');
    return `${label} ${present ? '✓' : '✗'}`;
  });
  md.appendMarkdown(`\n\n*Locales:* ${rows.join(' · ')}`);
}
