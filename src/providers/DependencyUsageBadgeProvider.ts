import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';
import artifactPackages from '../data/artifact-packages.json';

/**
 * KJ-022: usage badges for Gradle dependencies. Every implementation(…)
 * shows how many project imports actually come from the artifact.
 * BOMs and processors (ksp/kapt) are never misleading "0"s; an artifact
 * missing from the table is "unknown", never a false zero.
 */

export type DependencyClass =
  | { kind: 'counted'; imports: number }
  | { kind: 'bom' }
  | { kind: 'buildTime' }
  | { kind: 'unknown' };

const TABLE: Record<string, string[]> = artifactPackages as Record<string, string[]>;

export function classifyDependency(coordinate: string, imports: string[]): DependencyClass {
  const artifact = coordinate.split(':')[1] ?? coordinate;

  if (/-bom$/.test(artifact)) return { kind: 'bom' };
  if (/-(compiler|processor)$/.test(artifact) || /^ksp\b/.test(artifact)) {
    return { kind: 'buildTime' };
  }

  const prefixes = TABLE[coordinate];
  if (!prefixes) return { kind: 'unknown' };

  const count = imports.filter(imp => {
    const path = imp.replace(/^import\s+/, '').trim();
    return prefixes.some(p => path === p || path.startsWith(`${p}.`));
  }).length;
  return { kind: 'counted', imports: count };
}

/** toml alias (libs.retrofit.core) → catalog key (retrofit-core). */
export function aliasToCatalogKey(alias: string): string {
  return alias.replace(/^libs\./, '').replace(/\./g, '-');
}

/** group:name coordinates from the content of libs.versions.toml.
 *  Key order in the inline table is FREE in TOML: group/name/module are
 *  extracted independently of their position. */
export function parseCatalogCoordinates(tomlText: string): Map<string, string> {
  const out = new Map<string, string>();
  const entryRe = /^([\w-]+)\s*=\s*\{([^}]*)\}/gm;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(tomlText)) !== null) {
    const body = m[2];
    const module = /\bmodule\s*=\s*"([^"]+)"/.exec(body)?.[1];
    if (module) {
      out.set(m[1], module);
      continue;
    }
    const group = /\bgroup\s*=\s*"([^"]+)"/.exec(body)?.[1];
    const name = /\bname\s*=\s*"([^"]+)"/.exec(body)?.[1];
    if (group && name) out.set(m[1], `${group}:${name}`);
  }
  return out;
}

const CACHE_MS = 20_000;

export class DependencyUsageBadgeProvider implements vscode.Disposable {
  private readonly _badge = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 2em',
      color: new vscode.ThemeColor('editorLineNumber.foreground'),
    },
  });
  private readonly _dead = vscode.window.createTextEditorDecorationType({ opacity: '0.45' });
  private readonly _subs: vscode.Disposable[];
  private _cache: { at: number; imports: string[] } | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => void this._refresh()),
      vscode.workspace.onDidSaveTextDocument(() => {
        this._cache = undefined;
        void this._refresh();
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.dependencyUsageBadges')) void this._refresh();
      }),
    ];
    void this._refresh();
  }

  private async _workspaceImports(): Promise<string[]> {
    if (this._cache && Date.now() - this._cache.at < CACHE_MS) return this._cache.imports;
    const uris = await vscode.workspace.findFiles(
      '**/*.{kt,java}', '**/{build,.gradle,node_modules}/**', 4000,
    );
    const imports: string[] = [];
    for (const uri of uris) {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        for (const line of text.split('\n')) {
          const m = /^\s*import\s+([\w.]+)/.exec(line);
          if (m) imports.push(`import ${m[1]}`);
        }
      } catch {
        continue;
      }
    }
    this._cache = { at: Date.now(), imports };
    return imports;
  }

  private async _catalog(): Promise<Map<string, string>> {
    const files = await vscode.workspace.findFiles('**/libs.versions.toml', '**/build/**', 5);
    const out = new Map<string, string>();
    for (const f of files) {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(f));
        for (const [k, v] of parseCatalogCoordinates(text)) out.set(k, v);
      } catch {
        continue;
      }
    }
    return out;
  }

  private _label(c: DependencyClass): string {
    switch (c.kind) {
      case 'counted':
        return c.imports === 0 ? '0 imports' : `${c.imports} import${c.imports > 1 ? 's' : ''}`;
      case 'bom':
        return 'BOM';
      case 'buildTime':
        return 'build-time';
      case 'unknown':
        return '? imports';
    }
  }

  private async _refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const path = editor.document.uri.fsPath;
    const isGradle = /build\.gradle(\.kts)?$/.test(path);
    const isToml = /libs\.versions\.toml$/.test(path);
    if (!isGradle && !isToml) return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('dependencyUsageBadges', true);
    if (!enabled) {
      editor.setDecorations(this._badge, []);
      editor.setDecorations(this._dead, []);
      return;
    }

    const imports = await this._workspaceImports();
    const catalog = await this._catalog();
    const lines = editor.document.getText().split('\n');
    const badges: vscode.DecorationOptions[] = [];
    const dead: vscode.Range[] = [];

    for (let i = 0; i < lines.length; i++) {
      let coordinate: string | undefined;
      if (isGradle) {
        const m = /\b(?:implementation|api|compileOnly)\s*\(\s*libs((?:\.\w+)+)\s*\)/.exec(lines[i]);
        if (m) coordinate = catalog.get(aliasToCatalogKey(`libs${m[1]}`));
        const direct = /\b(?:implementation|api)\s*\(\s*"([^":]+:[^":]+):[^"]*"\s*\)/.exec(lines[i]);
        if (direct) coordinate = direct[1];
      } else {
        const m = /^([\w-]+)\s*=\s*\{\s*(?:group|module)\s*=/.exec(lines[i]);
        if (m) coordinate = catalog.get(m[1]);
      }
      if (!coordinate) continue;

      const cls = classifyDependency(coordinate, imports);
      badges.push({
        range: new vscode.Range(i, lines[i].length, i, lines[i].length),
        renderOptions: { after: { contentText: this._label(cls) } },
      });
      if (cls.kind === 'counted' && cls.imports === 0) {
        dead.push(new vscode.Range(i, 0, i, lines[i].length));
      }
    }
    editor.setDecorations(this._badge, badges);
    reportDecorations('dependencyUsageBadges', badges.length);
    editor.setDecorations(this._dead, dead);
  }

  dispose(): void {
    this._badge.dispose();
    this._dead.dispose();
    for (const s of this._subs) s.dispose();
  }
}
