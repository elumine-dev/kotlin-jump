import * as vscode from 'vscode';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import {
  ResourceDefinition,
  resolveWinner,
} from '../indexer/ResourcePriorityResolver';

/**
 * KJ-017: Resource Shadowing, hover on R.color.x / R.string.x defined in
 * several modules: the winning definition first, the losing ones struck
 * through, the locale/config overlays listed separately.
 */

const R_REF_RE = /\bR\.(color|string)\.(\w+)/g;

export function definitionFromPath(
  uriStr: string,
  value: string,
  rootName: string,
): ResourceDefinition | null {
  const m = /(?:^|[\\/])([^\\/]+)[\\/]src[\\/]([^\\/]+)[\\/]res[\\/]([^\\/]+)[\\/]/.exec(uriStr);
  if (!m) return null;
  const [, moduleDir, sourceSet, folder] = m;
  const isRoot = moduleDir === rootName;
  return {
    module: isRoot ? 'app' : moduleDir,
    moduleType: isRoot ? 'app' : 'library',
    sourceSet,
    folder,
    value,
  };
}

export class ResourceShadowingProvider implements vscode.HoverProvider {
  constructor(
    private readonly colors: ColorResourceIndex,
    private readonly strings: StringResourceIndex,
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('resourceShadowing', true)) return undefined;

    const line = document.lineAt(position.line).text;
    R_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_REF_RE.exec(line)) !== null) {
      if (position.character < m.index || position.character > m.index + m[0].length) continue;

      const kind = m[1] as 'color' | 'string';
      const key = m[2];
      const entries =
        kind === 'color' ? this.colors.allDefinitions(key) : this.strings.allDefinitions(key);
      if (entries.length < 2) return undefined;

      const rootName =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.split(/[\\/]/).pop() ?? '';
      const defs: { def: ResourceDefinition; uri: string; line: number }[] = [];
      for (const e of entries) {
        const def = definitionFromPath(e.uri.toString(), e.value, rootName);
        if (def) defs.push({ def, uri: e.uri.toString(), line: e.line });
      }
      if (defs.length < 2) return undefined;

      const resolved = resolveWinner(defs.map(d => d.def));
      if (resolved.shadowed.length === 0) return undefined;

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**R.${kind}.${key}**: ${defs.length} definitions (Gradle merge)\n\n`);
      const describe = (i: number) =>
        `\`${defs[i].def.module}\` · ${defs[i].def.sourceSet}/${defs[i].def.folder} → \`${defs[i].def.value}\``;
      // Two definitions in the SAME module/sourceSet/folder are not shadowing:
      // that is an Android merge error (duplicate resources).
      const bucket = (i: number) =>
        `${defs[i].def.module}|${defs[i].def.sourceSet}|${defs[i].def.folder}`;
      const winnerBucket = bucket(resolved.winner);
      md.appendMarkdown(`- 🏆 ${describe(resolved.winner)} **wins**\n`);
      for (const i of resolved.shadowed) {
        if (bucket(i) === winnerBucket) {
          md.appendMarkdown(
            `- ⚠ ${describe(i)} **duplicated in the same folder** (Android merge error, not shadowing)\n`,
          );
        } else {
          md.appendMarkdown(`- ~~${describe(i)}~~ shadowed\n`);
        }
      }
      for (const i of resolved.localeOverlays) {
        md.appendMarkdown(`- ${describe(i)} overlay (picked at runtime)\n`);
      }
      return new vscode.Hover(md, new vscode.Range(position.line, m.index, position.line, m.index + m[0].length));
    }
    return undefined;
  }
}
