import * as vscode from 'vscode';
import { mapBatched } from '../util/batched';
import { analyzeRoomSchema } from '../indexer/RoomSchemaIndex';

/**
 * KJ-020: Room Migration Drift. Diagnostics on @Entity fields with no
 * migration and on gaps in the chain. The analysis is workspace-wide
 * (entities, migrations and @Database often live in separate files)
 * with a short cache.
 */

// databaseBuilder catches the DI/module files: that is where addMigrations
// and fallbackToDestructiveMigration live, and the analyzer needs those
// chains to scope migrations to their database.
const ROOM_MARKER = /@Entity\b|@Database\b|(?<!\w)Migration\s*\(|\bdatabaseBuilder\s*\(/;
const CACHE_MS = 15_000;

export class RoomMigrationProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-room');
  private readonly _subs: vscode.Disposable[];
  private _cache: { at: number; files: Map<string, string> } | undefined;
  private _disposed = false;

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
    // Past the cap the file holding the migrations may be the one left out,
    // and every "hole" or "no ADD COLUMN" would be invented: stay silent.
    // Same budget as the indexer, and read the same way as everywhere else:
    // the declared default wins for a contributed setting, so a different
    // fallback here would only ever show up under a test stub.
    const cap = vscode.workspace.getConfiguration('kotlinJump').get<number>('maxIndexedFiles') ?? 10000;
    const uris = await vscode.workspace.findFiles('**/*.kt', '**/{build,.gradle}/**', cap + 1);
    if (uris.length > cap) { this._cache = { at: Date.now(), files }; return files; }
    // Reads used to be sequential: a save waited on up to 3000 round trips.
    const open = new Map<string, string>();
    for (const d of vscode.workspace.textDocuments) {
      if (d.languageId === 'kotlin') open.set(d.uri.toString(), d.getText());
    }
    const texts = new Map<string, string>();
    await mapBatched(uris, async uri => {
      const key = uri.toString();
      // Unsaved edits: the ranges are computed from this text, so the disk
      // copy put the underline on the wrong line while Entity.kt was dirty.
      const fromEditor = open.get(key);
      if (fromEditor !== undefined) { texts.set(key, fromEditor); return; }
      try {
        texts.set(key, new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
      } catch { /* unreadable: skipped */ }
    }, 16);
    // Map insertion order must follow findFiles order: the analyzer's
    // fileIndex refers to positions in the list built from it.
    for (const uri of uris) {
      const text = texts.get(uri.toString());
      if (text !== undefined && ROOM_MARKER.test(text)) files.set(uri.toString(), text);
    }
    this._cache = { at: Date.now(), files };
    return files;
  }

  private async _scanWorkspace(): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('roomMigrationDrift', true);
    if (!enabled) { this._diag.clear(); return; }

    // Clear only once the new set is ready: every save used to blank all
    // Room warnings for the seconds the workspace read took.
    const files = await this._roomFiles();
    // Reading the workspace takes seconds, and the state that started this
    // scan can be gone when it lands: the setting switched off, or the
    // provider disposed. Publishing anyway puts back the warnings the user
    // just turned off, and a disposed collection throws on the very clear
    // below.
    if (this._disposed) return;
    if (!vscode.workspace.getConfiguration('kotlinJump').get<boolean>('roomMigrationDrift', true)) {
      this._diag.clear();
      return;
    }
    if (files.size === 0) { this._diag.clear(); return; }

    // Keep the array in Map insertion order: the analyzer's fileIndex refers
    // to positions in this list.
    const entries = [...files];
    const analysis = analyzeRoomSchema(entries.map(([uriStr, text]) => ({ path: uriStr, text })));
    const perFile = new Map<string, vscode.Diagnostic[]>();
    const push = (uriStr: string, d: vscode.Diagnostic) => {
      if (!perFile.has(uriStr)) perFile.set(uriStr, []);
      perFile.get(uriStr)!.push(d);
    };

    for (const missing of analysis.missingFieldMigrations) {
      const [uriStr, text] = entries[missing.fileIndex] ?? [];
      if (uriStr === undefined) continue;
      const lines = text.split('\n');
      const entityAt = lines.findIndex(l => new RegExp(`class\\s+${missing.entity}\\b`).test(l));
      if (entityAt < 0) continue;
      const fieldAt = lines.findIndex(
        (l, i) => i >= entityAt && new RegExp(`va[lr]\\s+${missing.field}\\b`).test(l),
      );
      if (fieldAt < 0) continue;
      // The property, not the `"nickname"` inside its @ColumnInfo.
      const nameM = new RegExp(`va[lr]\\s+(${missing.field})\\b`).exec(lines[fieldAt]);
      const col = nameM ? nameM.index + nameM[0].length - missing.field.length : lines[fieldAt].indexOf(missing.field);
      const d = new vscode.Diagnostic(
        new vscode.Range(fieldAt, col, fieldAt, col + missing.field.length),
        `${missing.entity}.${missing.field}: no ADD COLUMN in any migration and no defaultValue. This crashes on upgrade.`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'kotlin-jump';
      d.code = 'room-migration-drift';
      push(uriStr, d);
    }

    for (const gap of analysis.migrationGaps) {
      const [uriStr, text] = entries[gap.fileIndex] ?? [];
      if (uriStr === undefined) continue;
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
    }

    this._diag.clear();
    for (const [uriStr, diags] of perFile) {
      this._diag.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  dispose(): void {
    this._disposed = true;
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
