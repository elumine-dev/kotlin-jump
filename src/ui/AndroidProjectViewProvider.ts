import * as vscode from 'vscode';

/**
 * KJ-012 — Android project view : Android Studio style tree.
 * Modules read from settings.gradle(.kts), with manifests / kotlin+java / res
 * (grouped by type, qualifiers as children) / Gradle Scripts nodes under each
 * module (Narwhal 3 behaviour).
 */

/** Modules declared through include(...), Kotlin and Groovy variants, one or
 *  several per call; commented-out lines are ignored. */
export function parseIncludedModules(settingsText: string): string[] {
  const modules: string[] = [];
  // Cut at // only outside strings, otherwise the https:// URLs of Maven
  // repos ate the rest of the line (and any include placed after them).
  const withoutComments = settingsText
    .split('\n')
    .map(l => {
      let inString: '"' | "'" | null = null;
      for (let i = 0; i < l.length - 1; i++) {
        const ch = l[i];
        if (inString) {
          if (ch === '\\') { i++; continue; }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'") { inString = ch; continue; }
        if (ch === '/' && l[i + 1] === '/') return l.slice(0, i);
      }
      return l;
    })
    .join('\n');

  const includeRe = /\binclude\s*\(([^)]*)\)|\binclude\s+((?:['"][^'"]+['"]\s*,?\s*)+)/g;
  let m: RegExpExecArray | null;
  while ((m = includeRe.exec(withoutComments)) !== null) {
    const argList = m[1] ?? m[2] ?? '';
    const quoted = argList.match(/['"]([^'"]+)['"]/g) ?? [];
    for (const q of quoted) modules.push(q.slice(1, -1));
  }
  return modules;
}

export interface ResGroup {
  type: string;
  base: string;
  qualifiers: string[];
}

/** Groups res files by type: `values-fr` becomes a qualifier child of the
 *  `values` group. */
export function groupResByType(paths: string[]): ResGroup[] {
  const groups = new Map<string, Set<string>>();

  for (const p of paths) {
    const m = /[\\/]res[\\/]([^\\/]+)[\\/]/.exec(p);
    if (!m) continue;
    const folder = m[1];
    const dash = folder.indexOf('-');
    const type = dash >= 0 ? folder.slice(0, dash) : folder;
    if (!groups.has(type)) groups.set(type, new Set());
    if (dash >= 0) groups.get(type)!.add(folder);
  }

  return [...groups.entries()].map(([type, quals]) => ({
    type,
    base: type,
    qualifiers: [...quals].sort(),
  }));
}

// ── TreeDataProvider ────────────────────────────────────────────────────────

const MAX_LISTED = 5_000;

function truncatedNode(modulePath: string | undefined): Node {
  return { kind: 'file', label: `… more files (only the first ${MAX_LISTED} are listed)`, modulePath };
}

type NodeKind = 'module' | 'manifests' | 'code' | 'res' | 'resType' | 'gradle' | 'file';

interface Node {
  kind: NodeKind;
  label: string;
  modulePath?: string;   // fs path of the module
  resType?: string;
  uri?: vscode.Uri;
  children?: Node[];
}

/**
 * Top-level nodes. With modules declared in settings.gradle, the root is not a
 * module: it used to be listed as "app (root)" with `**` globs under the
 * workspace, which repeated every module's manifest and res folder under it.
 * Android Studio shows the declared modules plus one Gradle Scripts node; a
 * project with no include() keeps the root as its single module.
 */
export function rootNodes(settingsText: string | undefined, root: vscode.Uri): Node[] {
  const modules = settingsText ? parseIncludedModules(settingsText) : [];
  if (modules.length === 0) return [{ kind: 'module', label: 'app (root)', modulePath: root.fsPath }];
  return [
    ...modules.map(m => ({
      kind: 'module' as const,
      label: m.replace(/^:/, ''),
      modulePath: vscode.Uri.joinPath(root, m.replace(/^:/, '').replace(/:/g, '/')).fsPath,
    })),
    { kind: 'gradle', label: 'Gradle Scripts', modulePath: root.fsPath },
  ];
}

export class AndroidProjectViewProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.resourceUri = node.uri;
      item.command = node.uri
        ? { command: 'vscode.open', title: 'Open', arguments: [node.uri] }
        : undefined;
      return item;
    }
    const item = new vscode.TreeItem(
      node.label,
      node.kind === 'module'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.contextValue = node.kind;
    item.iconPath = new vscode.ThemeIcon(
      { module: 'folder-library', manifests: 'file-code', code: 'symbol-namespace',
        res: 'symbol-color', resType: 'folder', gradle: 'gear', file: 'file' }[node.kind],
    );
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return [];

    if (!node) return rootNodes(await this._readSettings(ws.uri), ws.uri);

    if (node.kind === 'module') {
      return [
        { kind: 'manifests', label: 'manifests', modulePath: node.modulePath },
        { kind: 'code', label: 'kotlin+java', modulePath: node.modulePath },
        { kind: 'res', label: 'res', modulePath: node.modulePath },
        { kind: 'gradle', label: 'Gradle Scripts', modulePath: node.modulePath },
      ];
    }

    const rel = (pattern: string) =>
      new vscode.RelativePattern(node.modulePath ?? '', pattern);

    switch (node.kind) {
      case 'manifests': {
        const files = await vscode.workspace.findFiles(rel('**/AndroidManifest.xml'), '**/build/**', 20);
        return files.map(f => this._file(f));
      }
      case 'code': {
        // A cap of 500 sorted afterwards showed an arbitrary subset of an 800
        // file module with nothing saying so.
        const files = await vscode.workspace.findFiles(rel('src/**/*.{kt,java}'), '**/build/**', MAX_LISTED);
        const nodes = files.map(f => this._file(f)).sort((a, b) => a.label.localeCompare(b.label));
        return files.length >= MAX_LISTED ? [...nodes, truncatedNode(node.modulePath)] : nodes;
      }
      case 'res': {
        const files = await vscode.workspace.findFiles(rel('**/res/**/*.*'), '**/build/**', MAX_LISTED);
        const groups = groupResByType(files.map(f => f.fsPath));
        return groups.map(g => ({
          kind: 'resType' as const,
          label: g.qualifiers.length > 0 ? `${g.type} (+${g.qualifiers.length})` : g.type,
          modulePath: node.modulePath,
          resType: g.type,
        }));
      }
      case 'resType': {
        // `anim*` also matched `animator/`; only the type and its qualified variants.
        const files = await vscode.workspace.findFiles(
          rel(`**/res/{${node.resType},${node.resType}-*}/**/*.*`), '**/build/**', MAX_LISTED,
        );
        const nodes = files
          .map(f => this._file(f, /[\\/]res[\\/]([^\\/]+)[\\/]/.exec(f.fsPath)?.[1]))
          .sort((a, b) => a.label.localeCompare(b.label));
        return files.length >= MAX_LISTED ? [...nodes, truncatedNode(node.modulePath)] : nodes;
      }
      case 'gradle': {
        const files = await vscode.workspace.findFiles(
          rel('{build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,gradle/libs.versions.toml,gradle.properties}'),
          '**/build/**', 20,
        );
        return files.map(f => this._file(f));
      }
      default:
        return node.children ?? [];
    }
  }

  private _file(uri: vscode.Uri, qualifier?: string): Node {
    const name = uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
    return {
      kind: 'file',
      label: qualifier && qualifier.includes('-') ? `${name} (${qualifier})` : name,
      uri,
    };
  }

  private async _readSettings(root: vscode.Uri): Promise<string | undefined> {
    for (const name of ['settings.gradle.kts', 'settings.gradle']) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name));
        return new TextDecoder().decode(bytes);
      } catch {
        continue;
      }
    }
    return undefined;
  }
}
