import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { UnusedDtoFieldProvider, findUnusedDtoFields } from '../providers/UnusedDtoFieldProvider';
import { WriteOnlyKeyProvider, findWriteOnlyKeys } from '../providers/WriteOnlyKeyProvider';

/** KJ-044 and KJ-045 commands, both riding the shared corpus read. */

export async function findUnusedDtoFieldsCommand(
  corpus: ResourceCorpus,
  provider: UnusedDtoFieldProvider,
): Promise<void> {
  if (!UnusedDtoFieldProvider.isEnabled()) {
    void vscode.window.showInformationMessage('DTO field detection is disabled in settings.');
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for DTO fields nothing reads…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;
      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage('Could not read the whole workspace, so no field can be proven unread.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const found = findUnusedDtoFields({
        sources: data.sources,
        testSourceSets: cfg.get<string[]>('testSourceSets', ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest']),
        ignoreNames: cfg.get<string[]>('unusedDtoFieldsIgnoreNames', []),
      });
      provider.setFindings(found);
      const classes = new Set(found.map(x => x.className)).size;
      void vscode.window.showInformationMessage(found.length === 0
        ? `Every DTO field is read somewhere (${data.sources.length} files).`
        : `${found.length} DTO field${found.length > 1 ? 's' : ''} deserialized but never read, across ${classes} class${classes > 1 ? 'es' : ''}.`);
    },
  );
}

export async function findWriteOnlyKeysCommand(
  corpus: ResourceCorpus,
  provider: WriteOnlyKeyProvider,
): Promise<void> {
  if (!WriteOnlyKeyProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Write-only key detection is disabled in settings.');
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for keys written and never read…', cancellable: true },
    async (_progress, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;
      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage('Could not read the whole workspace, so no key can be proven write-only.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const scan = findWriteOnlyKeys({
        sources: data.sources,
        testSourceSets: cfg.get<string[]>('testSourceSets', ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest']),
        ignoreNames: cfg.get<string[]>('writeOnlyKeysIgnoreNames', []),
      });
      provider.setScan(scan);
      const poisonedKinds = [...new Set(scan.poisoned.map(p => p.kind))];
      const note = poisonedKinds.length > 0
        ? ` The ${poisonedKinds.join(' and ')} categor${poisonedKinds.length > 1 ? 'ies' : 'y'} could not be proven: reads with unresolvable keys exist.`
        : '';
      void vscode.window.showInformationMessage(scan.findings.length === 0
        ? `No write-only keys found.${note}`
        : `${scan.findings.length} key${scan.findings.length > 1 ? 's' : ''} written and never read.${note}`);
    },
  );
}
