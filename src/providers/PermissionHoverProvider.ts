import * as vscode from 'vscode';
import { lookupPermission } from '../data/permissionDescriptions';

/** Quick reject: must be cheap, runs on every hover in every file. */
const PERMISSION_LINE_RE = /Manifest\s*\.\s*permission\s*\.|android\.permission\./;

/**
 * Finds every permission reference on the line, in both spellings:
 *   Manifest.permission.CAMERA          (Kotlin/Java constant)
 *   "android.permission.CAMERA"         (string form, incl. AndroidManifest.xml)
 * Group 1 captures the permission name.
 */
const PERMISSION_REF_RE = /(?:\bManifest\s*\.\s*permission\s*\.\s*|\bandroid\.permission\.)([A-Z][A-Z0-9_]*)/g;

const PROTECTION_LABEL: Record<string, string> = {
  normal:    'normal · granted at install',
  dangerous: 'dangerous · requires a runtime request',
  special:   'special · granted in system settings',
  signature: 'signature · platform signed apps only',
};

/**
 * Shows what an Android permission does when hovering a reference to it,
 * in Kotlin/Java code or in AndroidManifest.xml.
 *
 *   Manifest.permission.ACCESS_FINE_LOCATION
 *   <uses-permission android:name="android.permission.CAMERA" />
 *
 * Backed by the static dictionary in `data/permissionDescriptions.ts`,
 * same approach as SuppressHoverProvider: unknown permissions simply get
 * no hover.
 */
export class PermissionHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
    const line = document.lineAt(position.line).text;
    if (!PERMISSION_LINE_RE.test(line)) return null;

    PERMISSION_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PERMISSION_REF_RE.exec(line)) !== null) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character > end) continue;

      const name = m[1];
      const info = lookupPermission(name);
      if (!info) return null;

      const nameStart = end - name.length;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${name}** · ${PROTECTION_LABEL[info.protection]}\n\n`);
      md.appendMarkdown(info.description);
      if (info.note) md.appendMarkdown(`\n\n_${info.note}_`);

      return new vscode.Hover(md, new vscode.Range(
        position.line, nameStart, position.line, end,
      ));
    }
    return null;
  }
}
