import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnusedEnumEntryProvider,
  findUnusedEnumEntries,
} from '../providers/UnusedEnumEntryProvider';

/** KJ-039 command. Shares the corpus read with the other workspace scans. */

export function enumEntrySettings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    testSourceSets: cfg.get<string[]>('testSourceSets', ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest']),
    ignoreNames: cfg.get<string[]>('unusedEnumEntriesIgnoreNames', []),
    includeTestOnly: cfg.get<boolean>('unusedEnumEntriesIncludeTestOnly', true),
  };
}

export async function findUnusedEnumEntriesCommand(
  corpus: ResourceCorpus,
  provider: UnusedEnumEntryProvider,
): Promise<void> {
  if (!UnusedEnumEntryProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Unused enum entry detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unused enum entries.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for unused enum entries…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no enum entry can be proven unused. '
          + 'Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const found = findUnusedEnumEntries({ sources: data.sources, ...enumEntrySettings() });
      provider.setFindings(found);

      if (found.length === 0) {
        void vscode.window.showInformationMessage(
          `Every enum entry is referenced somewhere (${data.sources.length} files).`,
        );
        return;
      }
      const enums = new Set(found.map(e => e.enumName)).size;
      const testOnly = found.filter(e => e.verdict === 'testOnly').length;
      void vscode.window.showInformationMessage(
        `${found.length} unused enum entr${found.length > 1 ? 'ies' : 'y'} across ${enums} enum${enums > 1 ? 's' : ''}`
        + `${testOnly > 0 ? `, ${testOnly} used only from tests` : ''}, in ${data.sources.length} files.`,
      );
    },
  );
}
