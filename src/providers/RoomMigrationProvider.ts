import * as vscode from 'vscode';
import { analyzeRoomSchema } from '../indexer/RoomSchemaIndex';

/**
 * KJ-020: Room Migration Drift. Diagnostics on @Entity fields with no
 * migration and on gaps in the chain. The analysis is workspace-wide
 * (entities, migrations and @Database often live in separate files)
 * with a short cache.
 */

const ROOM_MARKER = /@Entity\b|@Database\b|(?<!\w)Migration\s*\(/;
const CACHE_MS = 15_000;

export class RoomMigrationProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-room');
  private readonly _subs: vscode.Disposable[];
  private _cache: { at: number; files: Map<string, string> } | undefined;

  constructor() {
    this._subs = [
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId === 'kotlin' && ROOM_MARKER.test(doc.getText())) {
          this._cache = undefined;
          void this._scanWorkspace();
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.roomMigrationDrift')) {
          this._cache = undefined;
          void this._scanWorkspace();
        }
      }),
    ];
    void this._scanWorkspace();
  }

  private async _roomFiles(): Promise<Map<string, string>> {
    if (this._cache && Date.now() - this._cache.at < CACHE_MS) return this._cache.files;
    const files = new Map<string, string>();
    const uris = await vscode.workspace.findFiles('**/*.kt', '**/{build,.gradle}/**', 3000);
    for (const uri of uris) {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        if (ROOM_MARKER.test(text)) files.set(uri.toString(), text);
      } catch {
        continue;
      }
    }
    this._cache = { at: Date.now(), files };
    return files;
  }

  private async _scanWorkspace(): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('roomMigrationDrift', true);
    this._diag.clear();
    if (!enabled) return;

    const files = await this._roomFiles();
    if (files.size === 0) return;

    const analysis = analyzeRoomSchema([...files.values()]);
    const perFile = new Map<string, vscode.Diagnostic[]>();
    const push = (uriStr: string, d: vscode.Diagnostic) => {
      if (!perFile.has(uriStr)) perFile.set(uriStr, []);
      perFile.get(uriStr)!.push(d);
    };

    for (const missing of analysis.missingFieldMigrations) {
      for (const [uriStr, text] of files) {
        const lines = text.split('\n');
        const entityAt = lines.findIndex(l => new RegExp(`class\\s+${missing.entity}\\b`).test(l));
        if (entityAt < 0) continue;
        const fieldAt = lines.findIndex(
          (l, i) => i >= entityAt && new RegExp(`va[lr]\\s+${missing.field}\\b`).test(l),
        );
        if (fieldAt < 0) continue;
        const col = lines[fieldAt].indexOf(missing.field);
        const d = new vscode.Diagnostic(
          new vscode.Range(fieldAt, col, fieldAt, col + missing.field.length),
          `${missing.entity}.${missing.field}: no ADD COLUMN in any migration and no defaultValue. This crashes on upgrade.`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'kotlin-jump';
        d.code = 'room-migration-drift';
        push(uriStr, d);
        break;
      }
    }

    for (const gap of analysis.migrationGaps) {
      for (const [uriStr, text] of files) {
        const lines = text.split('\n');
        const dbAt = lines.findIndex(l => l.includes('@Database'));
        if (dbAt < 0) continue;
        const d = new vscode.Diagnostic(
          new vscode.Range(dbAt, 0, dbAt, lines[dbAt].length),
          `Migration chain has a hole: ${gap.from} to ${gap.to} is missing`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'kotlin-jump';
        d.code = 'room-migration-gap';
        push(uriStr, d);
        break;
      }
    }

    for (const [uriStr, diags] of perFile) {
      this._diag.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  dispose(): void {
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
