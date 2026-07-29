import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnusedResourceProvider,
  findUnusedResources,
  readSettings,
} from '../providers/UnusedResourceProvider';

/**
 * KJ-029 command: scans the workspace once and publishes every unused resource
 * file into the Problems panel. Cancellable, and it never runs on its own —
 * the scan is a user decision because it reads the whole workspace.
 */
export async function findUnusedResourcesCommand(
  corpus: ResourceCorpus,
  provider: UnusedResourceProvider,
): Promise<void> {
  const { enabled, includeDrawables } = readSettings();
  if (!enabled) {
    void vscode.window.showInformationMessage('Unused resource detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unused resources.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for unused resources…', cancellable: true },
    async (_progress, token) => {
      const scan = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (scan.truncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no resource can be proven unused. Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const findings = findUnusedResources({
        entries: scan.index.entries(),
        sources: scan.sources,
        modulesWithCode: scan.modulesWithCode,
        libraryModules: scan.libraryModules,
        includeDrawables,
      });

      const sizes = new Map<string, number>();
      await Promise.all(findings.flatMap(f => f.paths.map(async p => {
        try {
          sizes.set(p, (await vscode.workspace.fs.stat(vscode.Uri.file(p))).size);
        } catch {
          // a file we cannot stat simply contributes no bytes
        }
      })));
      provider.setFindings(findings, p => sizes.get(p));

      if (findings.length === 0) {
        void vscode.window.showInformationMessage('No unused resource files found.');
        return;
      }
      const bytes = [...sizes.values()].reduce((a, b) => a + b, 0);
      const review = findings.filter(f => !f.deletable).length;
      const reviewNote = review > 0 ? `, ${review} drawable${review > 1 ? 's' : ''} to review` : '';
      void vscode.window.showInformationMessage(
        `${findings.length} unused resource file${findings.length > 1 ? 's' : ''} — ${(bytes / 1024).toFixed(0)} KB${reviewNote}.`,
      );
    },
  );
}
