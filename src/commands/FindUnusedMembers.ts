import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import {
  UnusedMemberProvider,
  findUnusedMembers,
} from '../providers/UnusedMemberProvider';
import { plural } from '../util/plural';

/**
 * KJ-042 command.
 *
 * Runs KJ-032 first: a member of a class already reported whole must stay
 * silent (M12), one finding per root cause.
 */

export function memberSettings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
    ignoreNames: cfg.get<string[]>('unusedMembersIgnoreNames', []),
    ignorePaths: cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']),
    includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
    includeSelfOnly: cfg.get<boolean>('unusedMembersSelfOnly', true),
  };
}

export async function findUnusedMembersCommand(
  corpus: ResourceCorpus,
  provider: UnusedMemberProvider,
): Promise<void> {
  if (!UnusedMemberProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Unused member detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unused members.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for members nothing references…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no member can be proven unreferenced. '
          + 'Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const settings = memberSettings();
      const kj032 = findUnusedSymbols({
        sources: data.sources,
        testSourceSets: settings.testSourceSets,
      });
      const found = findUnusedMembers({
        sources: data.sources,
        ...settings,
        deadDeclarations: kj032.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
      });
      provider.setFindings(found);

      if (found.length === 0) {
        void vscode.window.showInformationMessage(
          `Every class member is referenced somewhere (${plural(data.sources.length, 'file')}).`,
        );
        return;
      }
      const unref = found.filter(m => m.verdict === 'unreferenced').length;
      const selfOnly = found.filter(m => m.verdict === 'selfOnly').length;
      const testOnly = found.filter(m => m.verdict === 'testOnly').length;
      void vscode.window.showInformationMessage(
        `${unref} unreferenced member${unref > 1 ? 's' : ''}`
        + `${selfOnly > 0 ? `, ${selfOnly} that could be private` : ''}`
        + `${testOnly > 0 ? `, ${testOnly} used only from tests` : ''}, across ${plural(data.sources.length, 'file')}.`,
      );
    },
  );
}
