import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';

const R_RE = /\bR\.(string|plurals|array)\.([A-Za-z_]\w*)\b/g;

export class StringResourceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: StringResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const lineText = document.lineAt(position.line).text;
    R_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const type = m[1] as 'string' | 'plurals' | 'array';
      const key  = m[2];
      const entry = type === 'string'  ? this.index.getValue(key)
                  : type === 'plurals' ? this.index.getPluralsValue(key)
                  :                      this.index.getArrayValue(key);
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
