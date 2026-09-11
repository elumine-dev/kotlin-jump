import * as vscode from 'vscode';
import { VersionCatalogIndex } from '../indexer/VersionCatalogIndex';

// Le motif etait ecrit en dur sur `libs`, donc un catalogue renomme
// (`deps.versions.toml`, lu `deps.x`) n'avait aucun survol, et un projet a
// deux catalogues n'en avait que pour le premier.
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const motifRacine = (root: string) => new RegExp(`\\b${echapper(root)}\\.([A-Za-z0-9_.]+)\\b`, 'g');

export class VersionCatalogHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: VersionCatalogIndex) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('versionCatalogHover', true);
    if (!enabled) return undefined;

    const fname = document.fileName;
    if (!fname.endsWith('.kts') && !fname.endsWith('.gradle')) return undefined;

    const line = document.lineAt(position.line).text;
    const contextPath = document.uri?.fsPath ?? fname;
    for (const root of this.index.rootsFor(contextPath)) {
      const re = motifRacine(root);
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end   = m.index + m[0].length;
        if (position.character < start || position.character > end) continue;
        // Plugins, versions and bundles resolve too: only libraries were read,
        // so `alias(libs.plugins.android.library)` showed nothing.
        const coords = this.index.describeAccessor(m[1], contextPath, root);
        if (!coords) continue;
        return new vscode.Hover(
          new vscode.MarkdownString(`\`${coords}\``),
          new vscode.Range(position.line, start, position.line, end),
        );
      }
    }
    return undefined;
  }
}
