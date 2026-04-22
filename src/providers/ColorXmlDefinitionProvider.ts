import * as vscode from 'vscode';
import { RResourceIndex } from '../indexer/RResourceIndex';

// Matches `name="key"` inside a resource tag
const RE_NAME_ATTR = /name="([A-Za-z_]\w*)"/g;

/**
 * Cmd+Click on `<color name="primary">` in `values/colors.xml` →
 * returns every `R.color.primary` usage in Kotlin/Java code.
 *
 * Mirrors `StringXmlDefinitionProvider` for the `<color>` tag. The
 * RResourceIndex now tracks 'color' alongside string/plurals/array,
 * so the lookup is a direct `getUsages('color', key)`.
 */
export class ColorXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly rIndex: RResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] {
    // Only process Android resource XML files
    if (!document.uri.path.includes('/res/')) return [];

    const lineText = document.lineAt(position.line).text;
    // Only fire on <color> tag lines — avoid accidentally mapping
    // other resources (attr, dimen, etc.) to the color usage index.
    if (!/<color\b/.test(lineText)) return [];

    RE_NAME_ATTR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_NAME_ATTR.exec(lineText))) {
      const attrStart = m.index;
      const attrEnd   = attrStart + m[0].length;
      if (position.character < attrStart || position.character >= attrEnd) continue;

      const key = m[1];
      const matchLen = `R.color.${key}`.length;
      return this.rIndex.getUsages('color', key).map(e =>
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
