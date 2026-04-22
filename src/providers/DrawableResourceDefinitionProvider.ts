import * as vscode from 'vscode';

const R_DRAWABLE_RE = /\bR\.(drawable|mipmap)\.([A-Za-z_]\w*)\b/g;

/**
 * Cmd+Click on `R.drawable.ic_pokeball` (or `R.mipmap.ic_launcher`) →
 * opens the corresponding file in `res/drawable*` / `res/mipmap*`.
 *
 * Drawable/mipmap resources are WHOLE FILES (vector XMLs, PNGs, WebPs)
 * rather than XML entries, so the resolution is a filesystem lookup
 * for `<key>.{xml,png,webp,svg,jpg,jpeg,9.png}` inside any
 * `res/(drawable|mipmap)*` qualifier folder.
 *
 * Uses `vscode.workspace.findFiles` on demand rather than maintaining
 * a dedicated index — drawable folders are small enough that the
 * lookup is cheap (< 20 ms on the fixture).
 */
export class DrawableResourceDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const lineText = document.lineAt(position.line).text;
    R_DRAWABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_DRAWABLE_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const kind = m[1]; // 'drawable' | 'mipmap'
      const key  = m[2];

      // Match any file extension commonly used in Android resources.
      // `res/drawable/` is the default, `-hdpi` / `-night` etc. variants
      // are also valid — glob catches them all.
      const pattern = `**/res/${kind}*/${key}.{xml,png,webp,svg,jpg,jpeg}`;
      const hits = await vscode.workspace.findFiles(pattern, undefined, 20);
      if (hits.length === 0) return undefined;

      // Stable ordering: default-density folder first, then qualifiers.
      hits.sort((a, b) => {
        const aDefault = /\/res\/drawable\//.test(a.path) || /\/res\/mipmap\//.test(a.path) ? 0 : 1;
        const bDefault = /\/res\/drawable\//.test(b.path) || /\/res\/mipmap\//.test(b.path) ? 0 : 1;
        return aDefault - bDefault || a.path.localeCompare(b.path);
      });

      const start0 = new vscode.Position(0, 0);
      return hits.map(uri => new vscode.Location(uri, new vscode.Range(start0, start0)));
    }
    return undefined;
  }
}
