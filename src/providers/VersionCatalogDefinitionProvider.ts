import * as vscode from 'vscode';
import { VersionCatalogIndex } from '../indexer/VersionCatalogIndex';

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
    const root = this.index.rootFor(contextPath);
    const line = document.lineAt(position.line).text;

    // The accessor as written, e.g. `libs.plugins.android.library`. Anchored on
    // the root so a plain `plugins { }` block is never mistaken for one.
    const re = new RegExp(`\\b${escapeForRegExp(root)}\\.([A-Za-z0-9_.]+)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (position.character < start || position.character > end) continue;
      const hit = this.index.locate(m[1], contextPath);
      if (!hit) continue;
      const { alias, file } = hit;
      return new vscode.Location(
        vscode.Uri.file(file),
        new vscode.Range(alias.line, alias.character, alias.line, alias.character + alias.raw.length),
      );
    }
    return undefined;
  }
}

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
