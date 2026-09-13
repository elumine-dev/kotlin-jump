import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { plural } from '../util/plural';
import { narrowToPrivate } from '../providers/narrowToPrivate';
import { stillTheMeasuredText } from '../util/measuredText';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';

/**
 * KJ-049: narrow every member that is only ever used inside its own class.
 *
 * The per-member lightbulb has been there since KJ-042, and it is the one fix
 * of the family the compiler fully re-checks behind us. What was missing is
 * scale: 142 of them on /Users/kevin/Desktop/work/lapresse, and clicking a
 * lightbulb 142 times is not a workflow.
 *
 * Overrides are already out of the detector (M2), so nothing here can break a
 * contract. Everything still goes through the Refactor Preview.
 */

export async function makeSelfOnlyPrivateCommand(corpus: ResourceCorpus): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }

  const balayer = async (token?: vscode.CancellationToken) => {
      const data = await corpus.get(token);
      if (token?.isCancellationRequested || data.sourcesTruncated) return undefined;
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const segs = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
      const ignorePaths = cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']);
      const symbols = findUnusedSymbols({
        sources: data.sources, testSourceSets: segs, libraryModules: data.libraryModules,
        ignorePaths, includeTestOnly: true,
        frameworkNameSuffixes: cfg.get<boolean>('unusedSymbolsFrameworkNameSuffixes', false),
      });
      const members = findUnusedMembers({
        sources: data.sources, testSourceSets: segs, ignorePaths,
        ignoreNames: cfg.get<string[]>('unusedMembersIgnoreNames', []),
        includeTestOnly: true, includeSelfOnly: true,
        deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
      });
      return {
        members: members.filter(m => m.verdict === 'selfOnly'),
        textByPath: new Map(data.sources.map(s => [s.path, s.text])),
        data,
      };
  };

  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for members that could be private…', cancellable: true },
    (_p, token) => balayer(token),
  );

  if (!found) {
    void vscode.window.showWarningMessage('The workspace is too large to prove where these members are used.');
    return;
  }
  if (found.members.length === 0) {
    void vscode.window.showInformationMessage('No member is used only inside its own class.');
    return;
  }

  // Built twice rather than once: the question cannot be asked before the
  // counts are known, and a WorkspaceEdit is a data structure, not an effect.
  // The only thing that differs between the two is the flag that decides
  // whether the preview opens and whether its boxes start ticked.
  const construire = (confirm: boolean, found: NonNullable<Awaited<ReturnType<typeof balayer>>>) => {
    const edit = new vscode.WorkspaceEdit();
    let applied = 0;
    let skipped = 0;
    // One member per line at most: two findings on one line would compute their
    // columns on the same pre-edit text and the second would land shifted.
    const takenLines = new Set<string>();

    for (const m of found.members) {
      // Same rule as the removal command: an offset is only valid against the
      // text it was measured on, and an open document that has moved on is
      // skipped rather than edited at a guessed position.
      const text = stillTheMeasuredText(m.path, found.textByPath.get(m.path));
      if (text === undefined) { skipped++; continue; }
      const lineText = text.split('\n')[m.line];
      // Re-verify against the text the scan measured: a line that no longer
      // holds the name is a line we must not touch.
      if (lineText === undefined || !lineText.includes(m.name)) { skipped++; continue; }
      const narrow = narrowToPrivate(lineText);
      if (!narrow) { skipped++; continue; }
      const key = `${m.path}:${m.line}`;
      if (takenLines.has(key)) { skipped++; continue; }
      takenLines.add(key);

      const label = `Make ${m.container}.${m.name} private`;
      edit.replace(
        corpusUri(m.path),
        new vscode.Range(m.line, narrow.column, m.line, narrow.column + narrow.length),
        narrow.text,
        { needsConfirmation: confirm, label },
      );
      applied++;
    }
    return { edit, applied, skipped, files: takenLines.size > 0 ? new Set([...takenLines].map(k => k.slice(0, k.lastIndexOf(':')))).size : 0 };
  };

  const apercu = construire(true, found);
  if (apercu.applied === 0) {
    void vscode.window.showInformationMessage('Nothing left to narrow: every finding was already private or had moved.');
    return;
  }

  const choix = await askHowToApply(
    `Narrow ${plural(apercu.applied, 'member')} to private?`,
    bulkDetail(apercu.applied, apercu.files),
  );
  if (choix === 'cancel') return;
  // The verdict is read again too. This one is judged across the WHOLE
  // workspace: a call that appears from elsewhere while the question is on
  // screen does not touch the declaring file, so rereading its text lets the
  // edit through and the `private` written there stops the caller compiling.
  // Same fix as 1.42.296, .297 and .298.
  //
  // Without paying for the scan twice: the corpus hands back its cached object
  // untouched while nothing has invalidated it, so identity says whether the
  // judgement has to be made again.
  let courant = found;
  if (choix === 'apply') {
    const frais = await corpus.get();
    if (frais !== found.data) {
      // Under a progress bar: this second judgement is the LONG part, twenty
      // seconds on six thousand files, and it sits after the question, when
      // the first bar has already closed. Left bare, the editor showed nothing
      // between the click and the edit. Only when the workspace actually
      // moved, so an unchanged one does not make a notification flash for
      // nothing.
      const relu = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'The workspace changed, checking again…' },
        () => balayer(),
      );
      if (!relu) {
        void vscode.window.showWarningMessage('The workspace is too large to prove where these members are used.');
        return;
      }
      if (relu.members.length === 0) {
        void vscode.window.showInformationMessage(
          'Nothing to narrow: the workspace changed while the question was open.');
        return;
      }
      courant = relu;
    }
  }
  const { edit, applied, skipped } = choix === 'apply' ? construire(false, courant) : apercu;

  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok
    ? `Narrowed ${plural(applied, 'member')} to private${skipped > 0 ? `, ${skipped} skipped` : ''}. The compiler checks the rest.`
    : 'Nothing was applied.');
}
