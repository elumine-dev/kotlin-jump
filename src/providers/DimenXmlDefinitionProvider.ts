import * as vscode from 'vscode';
import { RResourceIndex } from '../indexer/RResourceIndex';

const RE_NAME_ATTR = /name="([A-Za-z_]\w*)"/g;

/**
 * Cmd+Click on `<dimen name="spacing_md">` in `values/dimens.xml` →
 * returns every `R.dimen.spacing_md` usage in Kotlin/Java code.
 *
 * Mirrors `ColorXmlDefinitionProvider` for the `<dimen>` tag.
 */
export class DimenXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly rIndex: RResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] {
    if (!document.uri.path.includes('/res/')) return [];

    const lineText = document.lineAt(position.line).text;
    if (!/<dimen\b/.test(lineText)) return [];

    RE_NAME_ATTR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_NAME_ATTR.exec(lineText))) {
      const attrStart = m.index;
      const attrEnd   = attrStart + m[0].length;
      if (position.character < attrStart || position.character >= attrEnd) continue;

      const key = m[1];
      const matchLen = `R.dimen.${key}`.length;
      return this.rIndex.getUsages('dimen', key).map(e =>
        new vscode.Location(
          vscode.Uri.parse(e.uri),
          new vscode.Range(
            new vscode.Position(e.line, e.character),
            new vscode.Position(e.line, e.character + matchLen),
          ),
        ),
      );
    }
    return [];
  }
}
