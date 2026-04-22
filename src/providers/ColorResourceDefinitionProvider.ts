import * as vscode from 'vscode';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';

const R_COLOR_RE = /\bR\.color\.([A-Za-z_]\w*)\b/g;

/**
 * Cmd+Click on `R.color.xxx` → jumps to the matching `<color name="xxx">`
 * declaration in `values/colors.xml`. Mirrors `StringResourceDefinitionProvider`
 * for the R.color namespace.
 */
export class ColorResourceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: ColorResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const lineText = document.lineAt(position.line).text;
    R_COLOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_COLOR_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const key = m[1];
      const entry = this.index.getValue(key);
      if (!entry) return undefined;

      const pos = new vscode.Position(entry.line, 0);
      return new vscode.Location(
        vscode.Uri.parse(entry.uri.toString()),
        new vscode.Range(pos, pos),
      );
    }
    return undefined;
  }
}
