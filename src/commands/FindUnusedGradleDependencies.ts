import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnusedGradleDependencyProvider,
  findUnusedGradleDependencies,
} from '../providers/UnusedGradleDependencyProvider';

/** KJ-041 command. Shares the corpus read with the other workspace scans. */

export function gradleDependencySettings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return { ignoreNames: cfg.get<string[]>('unusedGradleDependenciesIgnoreNames', []) };
}

export async function findUnusedGradleDependenciesCommand(
  corpus: ResourceCorpus,
  provider: UnusedGradleDependencyProvider,
): Promise<void> {
  if (!UnusedGradleDependencyProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Gradle dependency detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for catalog aliases nothing references…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no alias can be proven unreferenced. '
          + 'Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const found = findUnusedGradleDependencies({ sources: data.sources, ...gradleDependencySettings() });
      provider.setFindings(found);

      if (found.length === 0) {
        void vscode.window.showInformationMessage('Every catalog alias is referenced by a build file.');
        return;
      }
      const versions = found.filter(a => a.orphanedVersion).length;
      void vscode.window.showInformationMessage(
        `${found.length} catalog alias${found.length > 1 ? 'es' : ''} nothing references`
        + `${versions > 0 ? `, freeing ${versions} version entr${versions > 1 ? 'ies' : 'y'}` : ''}.`,
      );
    },
  );
}
