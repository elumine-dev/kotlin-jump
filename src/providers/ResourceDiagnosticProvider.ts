import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';
import { isInsideCommentOrString } from '../util/textUtils';

const R_STRING_RE = /\bR\.string\.([A-Za-z_]\w*)\b/g;
const R_COLOR_RE  = /\bR\.color\.([A-Za-z_]\w*)\b/g;

export class ResourceDiagnosticProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-resources');
  private readonly _subs: vscode.Disposable[];

  constructor(
    private readonly strings: StringResourceIndex,
    private readonly colors: ColorResourceIndex,
  ) {
    this._subs = [
      vscode.workspace.onDidOpenTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => this._diag.delete(doc.uri)),
    ];
    for (const ed of vscode.window.visibleTextEditors) this._scan(ed.document);
  }

  invalidateAll(): void {
    for (const ed of vscode.window.visibleTextEditors) this._scan(ed.document);
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
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
