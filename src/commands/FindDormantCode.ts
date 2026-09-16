import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { plural } from '../util/plural';
import { findDormantCode, dormantSummary, DormantFinding } from '../providers/dormantCode';
import { makeRangeOf } from './RemoveTestOnlyCode';

/**
 * KJ-054: report the tests that never run and the code that lives in
 * comments, then offer each in the Refactor Preview with its box unticked.
 *
 * Never wired into `Remove Everything Unused`. An @Ignore was put there by
 * someone for a reason, and a commented block may be a worked example or a
 * note kept on purpose. Removing either is compile-safe, so the preview here
 * is a judgement aid, not a safety gate: every box starts unticked, and the
 * reason behind an @Ignore travels on the label.
 */
export async function findDormantCodeCommand(corpus: ResourceCorpus): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }
  const segs = vscode.workspace.getConfiguration('kotlinJump')
    .get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
  const minLines = vscode.workspace.getConfiguration('kotlinJump')
    .get<number>('dormantCodeMinCommentedLines', 5);

  const scan = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for ignored tests and commented-out code…', cancellable: true },
    async (_p, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return undefined;
      const findings = findDormantCode({ sources: data.sources, testSourceSets: segs, minCommentedLines: minLines, truncated: data.sourcesTruncated });
      return { findings, textByPath: new Map(data.sources.map(s => [s.path, s.text])) };
    },
  );
  if (!scan) return;

  const summary = dormantSummary(scan.findings);
  if (scan.findings.length === 0) {
    void vscode.window.showInformationMessage(summary);
    return;
  }

  const REVIEW = 'Review in Refactor Preview';
  const answer = await vscode.window.showInformationMessage(summary, { modal: true, detail: 'Nothing is removed until you tick it.' }, REVIEW);
  if (answer !== REVIEW) return;

  const rangeOf = makeRangeOf(scan.textByPath);
  const edit = new vscode.WorkspaceEdit();
  let offered = 0;
  let skipped = 0;
  for (const f of scan.findings) {
    const range = rangeOf(f.path, f.removeStart, f.removeEnd);
    if (!range) { skipped++; continue; }
    edit.replace(corpusUri(f.path), range, '', { needsConfirmation: true, label: labelFor(f) });
    offered++;
  }
  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok
    ? `Reviewed ${plural(offered, 'dormant item')}.`
    : 'Nothing was applied.');
  if (skipped > 0) {
    void vscode.window.showWarningMessage(`${plural(skipped, 'item')} skipped: the file changed since the scan. Run the command again.`);
  }
}

/** Exported for the witness: the label is the only place the reason is read. */
export function labelFor(f: DormantFinding): string {
  switch (f.kind) {
    case 'ignoredTest': return `Remove ignored test ${f.name}${f.reason ? ` (${f.reason})` : ''}`;
    case 'ignoredClass': return `Remove ignored test class ${f.name}${f.reason ? ` (${f.reason})` : ''}`;
    case 'commentedCode': return `Remove ${plural(f.lines, 'commented-out line')}`;
  }
}
