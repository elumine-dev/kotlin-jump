import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { DeadIslandProvider, findDeadIslands } from '../providers/DeadIslandProvider';
import { plural } from '../util/plural';

/**
 * KJ-046 command.
 *
 * The one detector where a finding's proof spans files by construction, so
 * the truncation gate matters twice: one unreadable file voids every island.
 */

export function islandSettings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
    ignoreNames: cfg.get<string[]>('deadIslandsIgnoreNames', []),
    includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
    maxIslandSize: cfg.get<number>('deadIslandsMaxSize', 8),
  };
}

/**
 * The one line the command reports.
 *
 * The noun agreed already; the rest of the sentence did not. One declaration
 * cannot `reference each other`, and the verb has to follow its subject, so
 * the parenthesis changes shape at one rather than losing an `s`.
 */
export function resumeIlots(
  islands: number,
  declarations: number,
  testOnly: number,
  files: number,
): string {
  const quoi = declarations === 1
    ? '1 declaration referenced by nothing else'
    : `${declarations} declarations that only reference each other`;
  const tests = testOnly > 0 ? `, ${testOnly} referenced only from tests` : '';
  return `${plural(islands, 'dead island')} (${quoi})${tests}, across ${plural(files, 'file')}.`;
}

export async function findDeadIslandsCommand(
  corpus: ResourceCorpus,
  provider: DeadIslandProvider,
): Promise<void> {
  if (!DeadIslandProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Dead island detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for dead islands.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for declarations that only reference each other…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no island can be proven dead. '
          + 'Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const found = findDeadIslands({ sources: data.sources, ...islandSettings() });
      provider.setFindings(found, new Map(data.sources.map(s => [s.path, s.text])));

      if (found.length === 0) {
        void vscode.window.showInformationMessage(
          `No dead islands: nothing is kept alive only by dead code (${plural(data.sources.length, 'file')}).`,
        );
        return;
      }
      const declarations = found.reduce((sum, i) => sum + i.members.length, 0);
      const testOnly = found.filter(i => i.verdict === 'testOnly').length;
      void vscode.window.showInformationMessage(
        resumeIlots(found.length, declarations, testOnly, data.sources.length),
      );
    },
  );
}
