import * as vscode from 'vscode';
import { countAllResourceUsages, ResKind, UsageSource } from './ResourceUsageBadgeProvider';
import { classifyDependency, aliasToCatalogKey, parseCatalogCoordinates } from './DependencyUsageBadgeProvider';
import { analyzeManifest, ProjectSearcher } from './ManifestNecessityProvider';
import { UnusedResourceKeyProvider } from './UnusedResourceKeyProvider';

/**
 * "Remove" quick fixes for everything the extension reports as unused.
 *
 * Kevin, 2026-07-25: "for every feature that tells me there is no usage,
 * I want the code action to delete it". Flagging dead weight without
 * offering to remove it leaves the work to the reader; the badge becomes
 * a remark instead of a tool.
 *
 * Covers: XML resources (strings/colors/dimens with 0 usage), Gradle
 * dependencies with 0 imports, manifest permissions with no code behind
 * them, and components whose class does not exist.
 */

const CACHE_MS = 20_000;

export class DeadWeightActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private _sources: { at: number; value: UsageSource[] } | undefined;
  private _imports: { at: number; value: string[] } | undefined;

  constructor() {
    // Warm-up: the first lightbulb used to scan ~4000 files on the spot,
    // VS Code gave up waiting, and the user saw NO action on a dead
    // dependency (reported 25/07). Prime the cache off the critical path.
    void this.workspaceSources().then(() => this.workspaceImports()).catch(() => {});
  }

  private _refreshing = false;

  private async scanSources(): Promise<UsageSource[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.{kt,java,xml}', '**/{build,.gradle,node_modules}/**', 4000,
    );
    const value: UsageSource[] = [];
    for (const uri of uris) {
      try {
        value.push({
          path: uri.fsPath,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        });
      } catch { continue; }
    }
    this._sources = { at: Date.now(), value };
    return value;
  }

  private async workspaceSources(): Promise<UsageSource[]> {
    if (this._sources) {
      // Stale-while-revalidate: an expired cache still answers the
      // lightbulb NOW; the refresh runs off the critical path. A cold
      // scan here made VS Code drop the request and the action vanished.
      if (Date.now() - this._sources.at >= CACHE_MS && !this._refreshing) {
        this._refreshing = true;
        void this.scanSources().finally(() => { this._refreshing = false; });
      }
      return this._sources.value;
    }
    return this.scanSources();
  }

  private async workspaceImports(): Promise<string[]> {
    if (this._imports && Date.now() - this._imports.at < CACHE_MS) return this._imports.value;
    const value: string[] = [];
    for (const s of await this.workspaceSources()) {
      if (!/\.(kt|java)$/.test(s.path)) continue;
      for (const line of s.text.split('\n')) {
        const m = /^\s*import\s+([\w.]+)/.exec(line);
        if (m) value.push(`import ${m[1]}`);
      }
    }
    this._imports = { at: Date.now(), value };
    return value;
  }

  /** Action that deletes lines `from`..`to` (inclusive). */
  private deleteLines(
    doc: vscode.TextDocument,
    title: string,
    from: number,
    to = from,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    const end = to + 1 <= doc.lineCount - 1
      ? new vscode.Position(to + 1, 0)
      : doc.lineAt(to).range.end;
    action.edit.delete(doc.uri, new vscode.Range(new vscode.Position(from, 0), end));
    return action;
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('deadWeightQuickFixes', true)) return [];

    const fsPath = document.uri.fsPath;
    const line = range.start.line;
    const lineText = document.lineAt(line).text;

    // ── XML resources with no usage ──────────────────────────────────────
    if (/[\\/]res[\\/]values[^\\/]*[\\/][^\\/]+\.xml$/.test(fsPath)) {
      // KJ-031 owns dead keys now: it covers nine kinds instead of three and
      // removes every qualifier variant, so offering both would mean two
      // near-identical titles deleting different amounts of text.
      if (UnusedResourceKeyProvider.isEnabled()) return [];
      const m = /<(string|color|dimen)\s+name="([^"]+)"/.exec(lineText);
      if (!m) return [];
      const kind = m[1] as ResKind;
      const name = m[2];
      const sources = (await this.workspaceSources()).filter(s => s.path !== fsPath);
      const count = countAllResourceUsages([{ kind, name }], sources).get(`${kind}/${name}`) ?? 0;
      if (count > 0) return [];
      // An entry can span several lines (<string>…</string>).
      let end = line;
      while (end < document.lineCount - 1 && !new RegExp(`</${kind}>`).test(document.lineAt(end).text)) {
        end++;
      }
      return [this.deleteLines(document, `Remove unused ${kind} ${name}`, line, end)];
    }

    // ── Gradle dependency with no import ─────────────────────────────────
    if (/build\.gradle(\.kts)?$/.test(fsPath)) {
      const alias = /\b(?:implementation|api|compileOnly)\s*\(\s*libs((?:\.\w+)+)\s*\)/.exec(lineText);
      const direct = /\b(?:implementation|api)\s*\(\s*"([^":]+:[^":]+):[^"]*"\s*\)/.exec(lineText);
      if (!alias && !direct) return [];

      let coordinate = direct?.[1];
      if (alias) {
        const tomls = await vscode.workspace.findFiles('**/libs.versions.toml', '**/build/**', 5);
        for (const t of tomls) {
          try {
            const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(t));
            coordinate = parseCatalogCoordinates(text).get(aliasToCatalogKey(`libs${alias[1]}`)) ?? coordinate;
          } catch { continue; }
        }
      }
      if (!coordinate) return [];
      const cls = classifyDependency(coordinate, await this.workspaceImports());
      if (cls.kind !== 'counted' || cls.imports > 0) return [];
      return [this.deleteLines(document, `Remove unused dependency ${coordinate}`, line)];
    }

    // ── Manifest: permission with no code, component with no class ───────
    if (/AndroidManifest\.xml$/.test(fsPath)) {
      const permMatch = /<uses-permission\b[^>]*android:name="([^"]+)"/.exec(lineText);
      const compMatch = /<(activity-alias|activity|service|receiver|provider)\b[^>]*android:name="([^"]+)"/.exec(lineText);
      if (!permMatch && !compMatch) return [];

      const sources = await this.workspaceSources();
      const project: ProjectSearcher = {
        classExists: fqn => {
          const simple = fqn.split('.').pop() ?? fqn;
          return sources.some(s => /\.(kt|java)$/.test(s.path) && new RegExp(`\\bclass\\s+${simple}\\b`).test(s.text));
        },
        searchApiUsage: patterns => {
          const found = new Set<string>();
          for (const p of patterns) {
            const re = new RegExp(p);
            for (const s of sources) if (/\.(kt|java)$/.test(s.path) && re.test(s.text)) found.add(s.path);
          }
          return [...found];
        },
      };
      const analysis = analyzeManifest(document.getText(), project);

      if (permMatch) {
        const status = analysis.permissions.find(p => p.name === permMatch[1])?.status;
        // The badge says "no usage found" for BOTH unused and maybe-lib:
        // the lightbulb must say the same thing (Kevin, 25/07). maybe-lib
        // keeps a cautious title, the user decides with full information.
        if (status !== 'unused' && status !== 'maybe-lib') return [];
        let end = line;
        while (end < document.lineCount - 1 && !/\/>|<\/uses-permission>/.test(document.lineAt(end).text)) end++;
        const short = permMatch[1].split('.').pop() ?? permMatch[1];
        const title = status === 'unused'
          ? `Remove unused permission ${short}`
          : `Remove permission ${short} (no usage in project code; a library may need it)`;
        return [this.deleteLines(document, title, line, end)];
      }

      const comp = analysis.components.find(c => c.name === compMatch![2]);
      if (comp?.status !== 'missing-class' && comp?.status !== 'unreferenced') return [];
      let end = line;
      const tag = compMatch![1];
      while (end < document.lineCount - 1 && !new RegExp(`/>|</${tag}>`).test(document.lineAt(end).text)) end++;
      const title = comp.status === 'missing-class'
        ? `Remove ${comp.name} (class not found)`
        : `Remove ${comp.name} (declared but never referenced)`;
      return [this.deleteLines(document, title, line, end)];
    }

    return [];
  }
}
