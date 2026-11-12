import * as vscode from 'vscode';
import { corpusUri } from '../util/corpusUri';
import { reportDecorations } from '../util/demoProbe';
import { UnusedResource, deleteTitleFor, messageFor } from './unusedResources';

// The detector lives in ./unusedResources, free of any editor API.
export * from './unusedResources';

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedResources';
const DRAWABLES_KEY = 'unusedResourcesIncludeDrawables';

/** Reads the two settings that govern the scan. */
export function readSettings(): { enabled: boolean; includeDrawables: boolean } {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    enabled: cfg.get<boolean>(CONFIG_KEY, true),
    includeDrawables: cfg.get<boolean>(DRAWABLES_KEY, false),
  };
}

export class UnusedResourceProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-resources');
  private readonly byPath = new Map<string, UnusedResource>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) {
          this.collection.delete(uri);
          this.byPath.delete(uri.fsPath);
        }
      }),
    ];
  }

  /** Replaces every finding with a fresh scan result. */
  setFindings(findings: UnusedResource[], sizeOf?: (path: string) => number | undefined): void {
    this.collection.clear();
    this.byPath.clear();
    for (const f of findings) {
      const bytes = sizeOf
        ? f.paths.reduce((sum, p) => sum + (sizeOf(p) ?? 0), 0)
        : undefined;
      const d = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        messageFor(f, bytes),
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-resource';
      for (const p of f.paths) {
        this.byPath.set(p, f);
        this.collection.set(corpusUri(p), [d]);
      }
    }
    reportDecorations('unusedResources', findings.length);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
    reportDecorations('unusedResources', 0);
  }

  provideCodeActions(document: vscode.TextDocument): vscode.CodeAction[] {
    if (!vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true)) return [];
    const finding = this.byPath.get(document.uri.fsPath);
    if (!finding || !finding.deletable) return [];

    const action = new vscode.CodeAction(deleteTitleFor(finding), vscode.CodeActionKind.QuickFix);
    const edit = new vscode.WorkspaceEdit();
    for (const p of finding.paths) {
      edit.deleteFile(
        corpusUri(p),
        { ignoreIfNotExists: true },
        { needsConfirmation: true, label: `Delete ${p.split('/').pop()}` },
      );
    }
    action.edit = edit;
    // Deleting a file is never the default lightbulb pick.
    action.isPreferred = false;
    return [action];
  }

  dispose(): void {
    this.collection.dispose();
    for (const s of this.subs) s.dispose();
  }
}
