import * as vscode from 'vscode';
import { lookupPermission } from '../data/permissionDescriptions';
import { stripXmlComments } from '../util/xmlRefs';

// <uses-permission android:name="android.permission.CAMERA" />
// and the <uses-permission-sdk-23> variant.
const USES_PERMISSION_RE = /<uses-permission(?:-sdk-23)?\b[^>]*android:name\s*=\s*"([^"]+)"/g;

export interface PermissionBadge { column: number; text: string; risk: 'normal' | 'dangerous' | 'special' | 'signature' | 'unknown' }

const BADGE: Record<PermissionBadge['risk'], string> = {
  normal:    '🟢 normal',
  dangerous: '🟡 dangerous',
  special:   '🔴 special',
  signature: '🔴 signature',
  unknown:   '⚪ unknown',
};

/**
 * Scans a whole manifest. Android Studio splits a tag over several lines as
 * soon as it carries `android:maxSdkVersion` or a `tools:` attribute, and the
 * line-by-line scan found nothing on those. The pill goes at the end of the
 * line that holds the `android:name` value.
 */
export function findManifestPermissionsInText(text: string): Array<PermissionBadge & { line: number }> {
  const out: Array<PermissionBadge & { line: number }> = [];
  // A permission the developer commented out is not requested by the app, so
  // it must not get a risk pill. stripXmlComments keeps offsets and line
  // breaks, so every position below still points into the real text.
  const scan = stripXmlComments(text);
  const re = new RegExp(USES_PERMISSION_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    const info = lookupPermission(m[1]);
    const risk = info?.protection ?? 'unknown';
    const end = m.index + m[0].length;
    const line = text.slice(0, end).split('\n').length - 1;
    const lineStart = text.lastIndexOf('\n', end - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = text.length;
    const lineText = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    out.push({ line, column: lineText.length, text: BADGE[risk], risk });
  }
  return out;
}

/** Scans one manifest line for uses-permission entries. Exported for tests. */
export function findManifestPermissions(text: string): PermissionBadge[] {
  const out: PermissionBadge[] = [];
  USES_PERMISSION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = USES_PERMISSION_RE.exec(text)) !== null) {
    const info = lookupPermission(m[1]);
    const risk = info?.protection ?? 'unknown';
    out.push({ column: text.length, text: BADGE[risk], risk });
  }
  return out;
}

/**
 * Colored risk pill at the end of every `<uses-permission>` line in
 * AndroidManifest.xml:
 *
 *   <uses-permission android:name="android.permission.CAMERA" />   🟡 dangerous
 *   <uses-permission android:name="android.permission.INTERNET" /> 🟢 normal
 *
 * Same dictionary as the permission hover, so hovering the line explains
 * the badge. Unknown permissions (vendor, custom) get a grey pill instead
 * of nothing: an unrecognized permission is worth a glance too.
 * Toggle with `kotlinJump.manifestPermissionBadges`.
 */
export class ManifestPermissionProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private _scanTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._decorType = vscode.window.createTextEditorDecorationType({});

    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => { if (e) this._scan(e); }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document) this._scheduleScan(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.manifestPermissionBadges')) this.refreshVisible();
      }),
    ];

    this.refreshVisible();
  }

  refreshVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) this._scan(editor);
  }

  private _scheduleScan(editor: vscode.TextEditor): void {
    if (this._scanTimer !== undefined) clearTimeout(this._scanTimer);
    this._scanTimer = setTimeout(() => {
      this._scanTimer = undefined;
      this._scan(editor);
    }, 100);
  }

  private _scan(editor: vscode.TextEditor): void {
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('manifestPermissionBadges', true);
    const isManifest = editor.document.uri.path.endsWith('AndroidManifest.xml');
    if (!isManifest || !enabled) {
      editor.setDecorations(this._decorType, []);
      return;
    }

    const decos: vscode.DecorationOptions[] = [];
    {
      for (const badge of findManifestPermissionsInText(editor.document.getText())) {
        const ln = badge.line;
        decos.push({
          range: new vscode.Range(ln, badge.column, ln, badge.column),
          renderOptions: {
            after: {
              contentText: `  ${badge.text}`,
              color: new vscode.ThemeColor('editorCodeLens.foreground'),
            },
          },
        });
      }
    }
    editor.setDecorations(this._decorType, decos);
  }

  dispose(): void {
    if (this._scanTimer !== undefined) clearTimeout(this._scanTimer);
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}
