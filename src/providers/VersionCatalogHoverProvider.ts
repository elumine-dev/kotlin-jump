import * as vscode from 'vscode';
import { VersionCatalogIndex } from '../indexer/VersionCatalogIndex';

const LIBS_RE = /\blibs\.([A-Za-z0-9_.]+)\b/g;

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
    LIBS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LIBS_RE.exec(line)) !== null) {
      const start = m.index;
      const end   = m.index + m[0].length;
      if (position.character < start || position.character > end) continue;
      const entry = this.index.getByAccessor(m[1]);
      if (!entry) continue;
      const coords = `${entry.group}:${entry.name}:${entry.version}`;
      return new vscode.Hover(
        new vscode.MarkdownString(`\`${coords}\``),
        new vscode.Range(position.line, start, position.line, end),
      );
    }
    return undefined;
  }
}
