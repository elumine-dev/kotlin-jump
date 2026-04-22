import * as vscode from 'vscode';
import { RResourceIndex, RType } from '../indexer/RResourceIndex';

const RES_PATH_RE = /\/res\/(drawable|mipmap)[^/]*\/([^/]+)\.(xml|png|webp|svg|jpg|jpeg)$/;
// Only fire on the root element of a vector/drawable XML — otherwise
// the provider would intercept Cmd+Click on attribute values or
// child tags that already have meaningful navigation targets.
const ROOT_TAG_RE = /^\s*<(vector|shape|selector|layer-list|ripple|inset|bitmap|clip|scale|rotate|animated-vector|transition)\b/;

/**
 * Cmd+Click on the root element of a `res/drawable*` or `res/mipmap*`
 * file (e.g. `<vector …>`, `<shape …>`) → returns every
 * `R.drawable.<basename>` / `R.mipmap.<basename>` usage in Kotlin/Java.
 *
 * The resource KEY is derived from the file basename (without the
 * extension), so this works for any drawable file type: vector XMLs,
 * raster PNGs, shape XMLs, etc.
 */
export class DrawableXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly rIndex: RResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] {
    const match = RES_PATH_RE.exec(document.uri.path);
    if (!match) return [];
    const kind: RType = match[1] === 'mipmap' ? 'mipmap' : 'drawable';
    const key = match[2];

    // Only respond on the root element line. Child elements like
    // `<path>` inside a vector already have their own navigation (none
    // at the moment), and firing on every position would make the
    // feature noisy.
    const lineText = document.lineAt(position.line).text;
    if (!ROOT_TAG_RE.test(lineText)) return [];

    const matchLen = `R.${kind}.${key}`.length;
    return this.rIndex.getUsages(kind, key).map(e =>
      new vscode.Location(
        vscode.Uri.parse(e.uri),
        new vscode.Range(
          new vscode.Position(e.line, e.character),
          new vscode.Position(e.line, e.character + matchLen),
        ),
      ),
    );
  }
}
