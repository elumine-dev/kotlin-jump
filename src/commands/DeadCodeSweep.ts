import * as vscode from 'vscode';
import { mapBatched } from '../util/batched';
import { makeExclusionMatcher } from '../util/pathExclusion';
import {
  SweepDetector,
  SweepFinding,
  planFileEdits,
  summarize,
  sweepFile,
} from '../providers/DeadCodeSweep';

/**
 * KJ-030: one command to see every dead thing at once, and one to remove them.
 *
 * The five per-file detectors already warn on the file you have open. This
 * scans the files you do NOT have open, which is where dead code actually
 * hides. `DeadCodeSweepReport` therefore drops a file's findings the moment
 * that file is opened, so a warning is never shown twice.
 *
 * Removal always goes through the Refactor Preview: a sweep can touch a
 * hundred files, and no one should discover that from an undo stack.
 */

const KOTLIN_GLOB = '**/*.kt';

const DETECTOR_LABEL: Record<SweepDetector, string> = {
  imports: 'imports',
  parameters: 'parameters',
  declarations: 'declarations',
  locals: 'variables',
  writeOnly: 'write-only variables',
};

export interface SweptFile {
  uri: vscode.Uri;
  findings: SweepFinding[];
}

export interface SweepScan {
  files: SweptFile[];
  truncated: boolean;
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('kotlinJump').get<boolean>('deadCodeSweep', true);
}

/** Reads every Kotlin file once and sweeps it. Cancellable, never automatic. */
export async function scanWorkspace(token?: vscode.CancellationToken): Promise<SweepScan> {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const maxFiles = cfg.get<number>('maxIndexedFiles', 10000);
  const isExcluded = makeExclusionMatcher(
    cfg.get<string[]>('excludePatterns', ['**/build/**', '**/.gradle/**', '**/generated/**']),
  );

  const uris = await vscode.workspace.findFiles(KOTLIN_GLOB, undefined, maxFiles);
  const truncated = uris.length >= maxFiles;
  const kept = uris.filter(u => !isExcluded(u.fsPath));

  const decoder = new TextDecoder();
  const files: SweptFile[] = [];
  await mapBatched(kept, async uri => {
    if (token?.isCancellationRequested) return;
    let text: string;
    try {
      text = decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return; // an unreadable file simply contributes nothing
    }
    const findings = sweepFile(text);
    if (findings.length > 0) files.push({ uri, findings });
  });

  files.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  return { files, truncated };
}

/** Publishes a scan into the Problems panel, minus whatever is already live. */
export class DeadCodeSweepReport implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-dead-code');
  private readonly byPath = new Map<string, SweepFinding[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      // The file's own live warnings take over as soon as it is open.
      vscode.workspace.onDidOpenTextDocument(doc => this.collection.delete(doc.uri)),
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri)),
    ];
  }

  setScan(scan: SweepScan): void {
    this.collection.clear();
    this.byPath.clear();
    const open = new Set(vscode.workspace.textDocuments.map(d => d.uri.fsPath));
    for (const file of scan.files) {
      this.byPath.set(file.uri.fsPath, file.findings);
      if (open.has(file.uri.fsPath)) continue;
      this.collection.set(file.uri, file.findings.map(toDiagnostic));
    }
  }

  findingsFor(path: string): SweepFinding[] | undefined {
    return this.byPath.get(path);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  private forget(uri: vscode.Uri): void {
    this.collection.delete(uri);
    this.byPath.delete(uri.fsPath);
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}

function toDiagnostic(finding: SweepFinding): vscode.Diagnostic {
  const start = new vscode.Position(finding.line, finding.character);
  const end = new vscode.Position(finding.line, finding.character + finding.name.length);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(start, end),
    finding.message,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = 'Kotlin Jump';
  diagnostic.code = `dead-code.${finding.detector}`;
  diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
  return diagnostic;
}

function describe(findings: readonly SweepFinding[]): string {
  const counts = summarize(findings);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([detector, n]) => `${n} ${DETECTOR_LABEL[detector]}`)
    .join(', ');
}

export async function findDeadCodeCommand(report: DeadCodeSweepReport): Promise<void> {
  if (!isEnabled()) {
    void vscode.window.showInformationMessage('Dead code sweep is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for dead code.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for dead code…', cancellable: true },
    async (_progress, token) => {
      const scan = await scanWorkspace(token);
      if (token.isCancellationRequested) return;

      report.setScan(scan);

      const all = scan.files.flatMap(f => f.findings);
      if (all.length === 0) {
        void vscode.window.showInformationMessage('No dead code found.');
        return;
      }
      const truncatedNote = scan.truncated ? ' Some files were skipped: raise kotlinJump.maxIndexedFiles.' : '';
      void vscode.window.showInformationMessage(
        `${all.length} findings in ${scan.files.length} files: ${describe(all)}.${truncatedNote}`,
      );
    },
  );
}

/** Removes every safely removable finding in the active editor, behind preview. */
export async function cleanDeadCodeInFileCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'kotlin') {
    void vscode.window.showWarningMessage('Open a Kotlin file to clean it.');
    return;
  }

  const text = editor.document.getText();
  const findings = sweepFile(text);
  const plan = planFileEdits(findings);
  if (plan.length === 0) {
    const skipped = findings.length;
    void vscode.window.showInformationMessage(
      skipped > 0
        ? `Nothing to remove automatically: ${skipped} findings need a per-case fix.`
        : 'No dead code in this file.',
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  for (const e of plan) {
    edit.replace(
      editor.document.uri,
      new vscode.Range(editor.document.positionAt(e.start), editor.document.positionAt(e.end)),
      e.text,
      { needsConfirmation: true, label: 'Remove dead code' },
    );
  }
  await vscode.workspace.applyEdit(edit);
}

/** The same, across every Kotlin file, in one preview. */
export async function cleanDeadCodeInWorkspaceCommand(): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before cleaning dead code.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Preparing the dead code sweep…', cancellable: true },
    async (_progress, token) => {
      const scan = await scanWorkspace(token);
      if (token.isCancellationRequested) return;

      const edit = new vscode.WorkspaceEdit();
      let count = 0;
      const decoder = new TextDecoder();
      for (const file of scan.files) {
        const plan = planFileEdits(file.findings);
        if (plan.length === 0) continue;
        let text: string;
        try {
          text = decoder.decode(await vscode.workspace.fs.readFile(file.uri));
        } catch {
          continue;
        }
        const starts = lineStartsOf(text);
        for (const e of plan) {
          edit.replace(file.uri, new vscode.Range(posAt(starts, e.start), posAt(starts, e.end)), e.text, {
            needsConfirmation: true,
            label: 'Remove dead code',
          });
          count++;
        }
      }

      if (count === 0) {
        void vscode.window.showInformationMessage('Nothing to remove automatically.');
        return;
      }
      await vscode.workspace.applyEdit(edit);
    },
  );
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts: readonly number[], offset: number): vscode.Position {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return new vscode.Position(low, offset - starts[low]);
}
