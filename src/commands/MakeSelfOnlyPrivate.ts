import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { plural } from '../util/plural';
import { narrowToPrivate } from '../providers/narrowToPrivate';
import { stillTheMeasuredText } from '../util/measuredText';

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

  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for members that could be private…', cancellable: true },
    async (_p, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested || data.sourcesTruncated) return undefined;
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
      };
    },
  );

  if (!found) {
    void vscode.window.showWarningMessage('The workspace is too large to prove where these members are used.');
    return;
  }
  if (found.members.length === 0) {
    void vscode.window.showInformationMessage('No member is used only inside its own class.');
    return;
  }

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
      { needsConfirmation: true, label },
    );
    applied++;
  }

  if (applied === 0) {
    void vscode.window.showInformationMessage('Nothing left to narrow: every finding was already private or had moved.');
    return;
  }

  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok
    ? `Narrowed ${plural(applied, 'member')} to private${skipped > 0 ? `, ${skipped} skipped` : ''}. The compiler checks the rest.`
    : 'Nothing was applied.');
}
