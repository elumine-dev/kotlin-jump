import * as vscode from 'vscode';
import { DimenResourceIndex } from '../indexer/DimenResourceIndex';

const R_DIMEN_RE = /\bR\.dimen\.([A-Za-z_]\w*)\b/g;

/**
 * Cmd+Click on `R.dimen.spacing_md` (or any other dimen key) → jumps
 * to the matching `<dimen name="…">` declaration in `values/dimens.xml`.
 * Mirrors `ColorResourceDefinitionProvider` for the R.dimen namespace.
 */
export class DimenResourceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: DimenResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const lineText = document.lineAt(position.line).text;
    R_DIMEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_DIMEN_RE.exec(lineText))) {
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
