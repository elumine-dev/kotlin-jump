import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';
import permissionApis from '../data/permission-apis.json';
import { MAX_SWEEP_FILES } from '../util/sweepLimit';

const MAX_SOURCES = MAX_SWEEP_FILES;

/**
 * KJ-023: necessity badges in the Manifest. Every <uses-permission> tells
 * whether a matching API usage exists in the code; declared components
 * whose class cannot be found are grayed out. Never a misleading claim:
 * permissions commonly pulled in by libs are marked "maybe-lib", not
 * "unused".
 */

const PERMISSION_APIS: Record<string, string[]> = permissionApis as Record<string, string[]>;

/** Permissions so often required by libs that an "unused" would be
 *  misleading (network, analytics, WorkManager…). */
const COMMONLY_LIB_OWNED = new Set([
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CHANGE_NETWORK_STATE',
  'android.permission.WAKE_LOCK',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.POST_NOTIFICATIONS',
]);

export interface ProjectSearcher {
  /** Whether any workspace source declares this package (a library class never does). */
  packageExists?: (pkg: string) => boolean;
  classExists(fqn: string): boolean;
  /** Files containing at least one of the patterns (regex-compatible). */
  searchApiUsage(patterns: string[]): string[];
}

export interface PermissionStatus {
  name: string;
  status: 'used' | 'unused' | 'maybe-lib';
  files: string[];
}

export interface ComponentStatus {
  name: string;
  status: 'ok' | 'missing-class' | 'unreferenced';
}

export interface ManifestAnalysis {
  permissions: PermissionStatus[];
  components: ComponentStatus[];
}

export function analyzeManifest(manifestXml: string, project: ProjectSearcher): ManifestAnalysis {
  const xml = manifestXml.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const packageName = /package="([^"]+)"/.exec(xml)?.[1] ?? '';

  const permissions: PermissionStatus[] = [];
  const permRe = /<uses-permission\b([^>]*)android:name="([^"]+)"([^>]*)/g;
  let m: RegExpExecArray | null;
  while ((m = permRe.exec(xml)) !== null) {
    // `tools:node="remove"` takes a permission away from a merged manifest;
    // it was badged "no usage found" and grayed like a declaration.
    if (/tools:node="remove"/.test(m[1] + m[3])) continue;
    const name = m[2];
    const patterns = PERMISSION_APIS[name];
    const files = patterns ? project.searchApiUsage(patterns) : [];
    let status: PermissionStatus['status'];
    if (files.length > 0) status = 'used';
    else if (COMMONLY_LIB_OWNED.has(name) || !patterns) status = 'maybe-lib';
    else status = 'unused';
    permissions.push({ name, status, files });
  }

  const components: ComponentStatus[] = [];
  // activity-alias BEFORE activity in the alternation (common prefix).
  const compRe = /<(activity-alias|activity|service|receiver|provider)\b([^>]*)(\/>|>)/g;
  while ((m = compRe.exec(xml)) !== null) {
    const tag = m[1];
    const attrs = m[2];
    const selfClosing = m[3] === '/>';
    const nameM = /android:name="([^"]+)"/.exec(attrs);
    if (!nameM) continue;
    if (/tools:node="remove"/.test(attrs)) continue;
    const rawName = nameM[1];
    // An alias has no class of its own: its targetActivity is what we resolve.
    const classRef =
      tag === 'activity-alias'
        ? /android:targetActivity="([^"]+)"/.exec(attrs)?.[1] ?? rawName
        : rawName;
    const fqn = classRef.startsWith('.') ? packageName + classRef : classRef;

    let hasIntentFilter = false;
    if (!selfClosing) {
      const close = xml.indexOf(`</${tag}>`, m.index);
      const blockEnd = close >= 0 ? close : xml.length;
      hasIntentFilter = xml.slice(m.index, blockEnd).includes('<intent-filter');
    }

    let status: ComponentStatus['status'];
    // A class from a library (androidx.core.content.FileProvider, Firebase's
    // init provider) is not in the workspace sources; only a class in a
    // package the workspace declares can be missing.
    const pkg = fqn.slice(0, fqn.lastIndexOf('.'));
    const inWorkspacePackage = pkg === '' || (packageName !== '' && (pkg === packageName || pkg.startsWith(`${packageName}.`)))
      || (project.packageExists?.(pkg) ?? true);
    if (!inWorkspacePackage) status = 'ok'; // a library's class: nothing to check, nothing to remove
    else if (!project.classExists(fqn)) status = 'missing-class';
    else if (hasIntentFilter) status = 'ok';
    else status = project.searchApiUsage([fqn.split('.').pop() ?? fqn]).length > 0 ? 'ok' : 'unreferenced';

    components.push({ name: rawName, status });
  }

  return { permissions, components };
}

export class ManifestNecessityProvider implements vscode.Disposable {
  private readonly _badge = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 2em',
      color: new vscode.ThemeColor('editorLineNumber.foreground'),
    },
  });
  private readonly _dead = vscode.window.createTextEditorDecorationType({ opacity: '0.45' });
  private readonly _subs: vscode.Disposable[];
  private _disposed = false;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => void this._refresh()),
      vscode.workspace.onDidSaveTextDocument(() => void this._refresh()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.manifestNecessityBadges')) void this._refresh();
      }),
    ];
    void this._refresh();
  }

  private async _refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !/AndroidManifest\.xml$/.test(editor.document.uri.fsPath)) return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('manifestNecessityBadges', true);
    if (!enabled) {
      editor.setDecorations(this._badge, []);
      editor.setDecorations(this._dead, []);
      return;
    }

    // Project sources for the usage search.
    const uris = await vscode.workspace.findFiles(
      '**/*.{kt,java}', '**/{build,.gradle}/**', MAX_SOURCES,
    );
    // Past the cap the class may sit in a file never listed: "class not
    // found" then invited the user to remove a live activity.
    const truncated = uris.length >= MAX_SOURCES;
    const sources: { path: string; text: string }[] = [];
    for (const uri of uris) {
      try {
        sources.push({
          path: uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        });
      } catch {
        continue;
      }
    }
    // Reading every source of the project takes seconds. Whatever started this
    // pass may be gone by now: the setting switched off, or the provider
    // disposed. Painting either way redraws what the user turned off and
    // writes through a decoration type that no longer exists.
    if (this._disposed) return;
    if (!vscode.workspace.getConfiguration('kotlinJump').get<boolean>('manifestNecessityBadges', true)) {
      editor.setDecorations(this._badge, []);
      editor.setDecorations(this._dead, []);
      return;
    }

    const project: ProjectSearcher = {
      classExists: fqn => {
        const simple = fqn.split('.').pop() ?? fqn;
        return sources.some(s => new RegExp(`\\bclass\\s+${simple}\\b`).test(s.text));
      },
      packageExists: pkg => sources.some(s => new RegExp(`^\\s*package\\s+${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(s.text)),
      searchApiUsage: patterns => {
        const found = new Set<string>();
        for (const p of patterns) {
          const re = new RegExp(p);
          for (const s of sources) if (re.test(s.text)) found.add(s.path);
        }
        return [...found];
      },
    };

    const text = editor.document.getText();
    const lines = text.split('\n');
    const { permissions, components } = analyzeManifest(text, project);
    if (truncated) {
      for (const c of components) c.status = 'ok';
      for (const p of permissions) p.status = 'maybe-lib';
    }

    const badges: vscode.DecorationOptions[] = [];
    const dead: vscode.Range[] = [];
    const badgeAt = (needle: string, label: string, gray: boolean) => {
      const line = lines.findIndex(l => l.includes(needle));
      if (line < 0) return;
      badges.push({
        range: new vscode.Range(line, lines[line].length, line, lines[line].length),
        renderOptions: { after: { contentText: label } },
      });
      if (gray) dead.push(new vscode.Range(line, 0, line, lines[line].length));
    };

    for (const p of permissions) {
      const label =
        p.status === 'used'
          ? `used in ${p.files.length} file${p.files.length > 1 ? 's' : ''}`
          : p.status === 'maybe-lib'
            ? 'may come from a library'
            : 'no usage found';
      badgeAt(`"${p.name}"`, label, p.status === 'unused');
    }
    for (const c of components) {
      if (c.status === 'ok') continue;
      badgeAt(
        `android:name="${c.name}"`,
        c.status === 'missing-class' ? 'class not found' : 'never referenced',
        true,
      );
    }
    editor.setDecorations(this._badge, badges);
    reportDecorations('manifestNecessity', badges.length);
    editor.setDecorations(this._dead, dead);
  }

  dispose(): void {
    this._disposed = true;
    this._badge.dispose();
    this._dead.dispose();
    for (const s of this._subs) s.dispose();
  }
}
