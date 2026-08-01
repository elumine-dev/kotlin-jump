import * as vscode from 'vscode';
import { WriteOnlyKey, WriteOnlyKeyScan, messageFor } from './writeOnlyKeys';

/** KJ-045 VS Code shell. Diagnostics only: the fix is writing the reader. */

export * from './writeOnlyKeys';

const CONFIG_KEY = 'writeOnlyKeys';

export class WriteOnlyKeyProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-write-only-keys');
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidChangeTextDocument(e => this.collection.delete(e.document.uri)),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  setScan(scan: WriteOnlyKeyScan): void {
    this.collection.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const add = (path: string, d: vscode.Diagnostic) => {
      const list = byFile.get(path) ?? [];
      list.push(d);
      byFile.set(path, list);
    };
    for (const f of scan.findings) {
      const d = new vscode.Diagnostic(
        new vscode.Range(f.line, 0, f.line, 200), messageFor(f), vscode.DiagnosticSeverity.Warning);
      d.source = 'kotlin-jump';
      d.code = `write-only-${f.kind}`;
      add(f.path, d);
    }
    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}
