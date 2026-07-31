import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnusedRemoteConfigKey,
  UnusedRemoteConfigKeyProvider,
  findUnusedRemoteConfigKeys,
} from '../providers/UnusedRemoteConfigKeyProvider';

/** KJ-040 commands. Shares the corpus read with the other workspace scans. */

export function remoteConfigSettings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return { ignoreNames: cfg.get<string[]>('unusedRemoteConfigKeysIgnoreNames', []) };
}

export async function findUnusedRemoteConfigKeysCommand(
  corpus: ResourceCorpus,
  provider: UnusedRemoteConfigKeyProvider,
): Promise<void> {
  if (!UnusedRemoteConfigKeyProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Remote Config key detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for Remote Config keys nothing reads…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no key can be proven unread. '
          + 'Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      const found = findUnusedRemoteConfigKeys({ sources: data.sources, ...remoteConfigSettings() });
      provider.setFindings(found);

      if (found.length === 0) {
        void vscode.window.showInformationMessage('Every Remote Config default is read somewhere.');
        return;
      }
      const declarations = found.reduce((n, k) => n + k.declarations.length, 0);
      void vscode.window.showInformationMessage(
        `${found.length} Remote Config key${found.length > 1 ? 's' : ''} nothing reads`
        + `, across ${declarations} declaration${declarations > 1 ? 's' : ''}.`,
      );
    },
  );
}

/** Removes every unread key from every variant that declares it, behind preview. */
export async function removeAllUnusedRemoteConfigKeysCommand(
  corpus: ResourceCorpus,
  provider: UnusedRemoteConfigKeyProvider,
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Preparing the removal…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested || data.sourcesTruncated) return;

      const found = findUnusedRemoteConfigKeys({ sources: data.sources, ...remoteConfigSettings() });
      provider.setFindings(found);
      if (found.length === 0) {
        void vscode.window.showInformationMessage('Nothing to remove.');
        return;
      }

      // Group by file and apply back to front, so an earlier removal never
      // shifts the offsets of a later one.
      const byFile = new Map<string, UnusedRemoteConfigKey['declarations']>();
      for (const key of found) {
        for (const d of key.declarations) {
          const list = byFile.get(d.path) ?? [];
          list.push(d);
          byFile.set(d.path, list);
        }
      }

      const edit = new vscode.WorkspaceEdit();
      const decoder = new TextDecoder();
      for (const [path, declarations] of byFile) {
        const uri = vscode.Uri.file(path);
        let text: string;
        try {
          text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        } catch {
          continue;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        for (const d of [...declarations].sort((a, b) => b.removeStart - a.removeStart)) {
          // Re-verify against the text we just read: a stale offset must never
          // aim a deletion at something else.
          if (!text.slice(d.removeStart, d.removeEnd).includes('<key>')) continue;
          edit.delete(uri, new vscode.Range(doc.positionAt(d.removeStart), doc.positionAt(d.removeEnd)),
            { needsConfirmation: true, label: 'Remove unread Remote Config keys' });
        }
      }
      await vscode.workspace.applyEdit(edit);
    },
  );
}
