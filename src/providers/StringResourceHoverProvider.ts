import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';

const R_STRING_RE = /\bR\.string\.([A-Za-z_]\w*)\b/g;

export class StringResourceHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: StringResourceIndex) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return;

    const lineText = document.lineAt(position.line).text;
    R_STRING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_STRING_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const entry = this.index.getValue(m[1]);
      if (!entry) return;

      const uriStr  = entry.uri.toString();
      const resIdx  = uriStr.lastIndexOf('/res/');
      const displayPath = resIdx >= 0
        ? uriStr.slice(resIdx + 1)
        : uriStr.split('/').slice(-2).join('/');

      const md = new vscode.MarkdownString();
      md.appendCodeblock(entry.value, 'text');
      md.appendMarkdown(`\n\`${m[1]}\` — ${displayPath}:${entry.line + 1}`);

      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }
  }
}
