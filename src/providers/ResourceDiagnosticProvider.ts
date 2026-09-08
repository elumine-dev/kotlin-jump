import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';
import { isInsideCommentOrString } from '../util/textUtils';

// `android.R.string.ok`, `androidx.core.R.x` and Material's R live outside the
// workspace index; a project R qualified by its module package stays in.
const R_STRING_RE = /(?<!(?<![\w.])android\.)(?<!(?<![\w.])androidx\.[\w.]*)(?<!(?<![\w.])com\.google\.(?:android|firebase)[\w.]*\.)\bR\.string\.([A-Za-z_]\w*)\b/g;
const R_COLOR_RE  = /(?<!(?<![\w.])android\.)(?<!(?<![\w.])androidx\.[\w.]*)(?<!(?<![\w.])com\.google\.(?:android|firebase)[\w.]*\.)\bR\.color\.([A-Za-z_]\w*)\b/g;

export class ResourceDiagnosticProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-resources');
  private readonly _subs: vscode.Disposable[];
  private readonly _pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly strings: StringResourceIndex,
    private readonly colors: ColorResourceIndex,
  ) {
    this._subs = [
      vscode.workspace.onDidOpenTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => { this._cancel(doc); this._diag.delete(doc.uri); }),
      // Only open/save used to trigger a scan: a fixed key stayed red, with
      // the old name in the message, until the next save.
      vscode.workspace.onDidChangeTextDocument(e => this._scheduleScan(e.document)),
      // Turning the setting off left every error in Problems until each file
      // was saved or reopened; _scan() deletes when disabled.
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.resourceDiagnostics')) this.invalidateAll();
      }),
    ];
    for (const ed of vscode.window.visibleTextEditors) this._scan(ed.document);
  }

  invalidateAll(): void {
    for (const ed of vscode.window.visibleTextEditors) this._scan(ed.document);
  }

  private _scheduleScan(doc: vscode.TextDocument): void {
    if (doc.languageId !== 'kotlin' && doc.languageId !== 'java') return;
    this._cancel(doc);
    this._pending.set(doc.uri.toString(), setTimeout(() => {
      this._pending.delete(doc.uri.toString());
      this._scan(doc);
    }, 300));
  }

  private _cancel(doc: vscode.TextDocument): void {
    const t = this._pending.get(doc.uri.toString());
    if (t) { clearTimeout(t); this._pending.delete(doc.uri.toString()); }
  }

  private _scan(doc: vscode.TextDocument): void {
    const lang = doc.languageId;
    if (lang !== 'kotlin' && lang !== 'java') { this._diag.delete(doc.uri); return; }
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('resourceDiagnostics', true);
    if (!enabled) { this._diag.delete(doc.uri); return; }

    const diags: vscode.Diagnostic[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;

      R_STRING_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = R_STRING_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        if (!this.strings.getValue(m[1])) {
          const d = new vscode.Diagnostic(
            new vscode.Range(i, m.index, i, m.index + m[0].length),
            `Cannot resolve string resource '${m[1]}'`,
            vscode.DiagnosticSeverity.Error,
          );
          d.source = 'Kotlin Jump';
          diags.push(d);
        }
      }

      R_COLOR_RE.lastIndex = 0;
      while ((m = R_COLOR_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        if (!this.colors.getValue(m[1])) {
          const d = new vscode.Diagnostic(
            new vscode.Range(i, m.index, i, m.index + m[0].length),
            `Cannot resolve color resource '${m[1]}'`,
            vscode.DiagnosticSeverity.Error,
          );
          d.source = 'Kotlin Jump';
          diags.push(d);
        }
      }
    }
    this._diag.set(doc.uri, diags);
  }

  dispose(): void {
    for (const t of this._pending.values()) clearTimeout(t);
    this._pending.clear();
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
