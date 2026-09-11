import * as vscode from 'vscode';
import { VersionCatalogIndex, accessorRegExp } from '../indexer/VersionCatalogIndex';

/**
 * Ctrl+click on `libs.plugins.android.library` inside a build file and land on
 * the line that declares it in `gradle/libs.versions.toml`.
 *
 * The catalog was already parsed for the hover, but the hover only knows
 * libraries, so an `alias(libs.plugins.…)` line offered nothing at all.
 */
export class VersionCatalogDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: VersionCatalogIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location | undefined {
    const fname = document.fileName;
    if (!fname.endsWith('.kts') && !fname.endsWith('.gradle')) return undefined;

    const contextPath = document.uri?.fsPath ?? fname;
    const line = document.lineAt(position.line).text;

    // Un projet peut exposer plusieurs racines, `libs` et `testLibs` par
    // exemple. N'en essayer qu'une laissait l'autre sans reponse.
    for (const root of this.index.rootsFor(contextPath)) {
      // The accessor as written, e.g. `libs.plugins.android.library`. Anchored
      // on the root so a plain `plugins { }` block is never mistaken for one.
      const re = accessorRegExp(root);
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (position.character < start || position.character > end) continue;
        const hit = this.index.locate(m[1], contextPath, root);
        if (!hit) continue;
        const { alias, file } = hit;
        return new vscode.Location(
          HAS_SCHEME.test(file) ? vscode.Uri.parse(file) : vscode.Uri.file(file),
          new vscode.Range(alias.line, alias.character, alias.line, alias.character + alias.raw.length),
        );
      }
    }
    return undefined;
  }
}

// `vscode-vfs://…` on the web, a plain path when the caller only had one.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
