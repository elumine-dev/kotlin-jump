import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  collectValueKeyDeclarations,
  parseValuesPath,
} from '../indexer/ValueResourceScanner';
import {
  UnusedResourceKey,
  UnusedResourceKeyProvider,
  buildRemovalEdit,
  findUnusedResourceKeys,
} from '../providers/UnusedResourceKeyProvider';

/**
 * KJ-031 commands. The scan reads the whole workspace, so it is always a user
 * decision, never automatic, and always cancellable.
 */

const KIND_ORDER = ['string', 'color', 'dimen', 'style', 'attr', 'integer', 'bool', 'array', 'plurals'];

async function scan(
  corpus: ResourceCorpus,
  token?: vscode.CancellationToken,
): Promise<{ findings: UnusedResourceKey[]; truncated: boolean } | undefined> {
  const corpusData = await corpus.get(token);
  if (token?.isCancellationRequested) return undefined;

  const moduleDirs = corpusData.modulesWithCode;
  const declarations = corpusData.sources
    .filter(s => parseValuesPath(s.path) !== undefined)
    .flatMap(s => collectValueKeyDeclarations(s.path, s.text, moduleDirs));

  const findings = findUnusedResourceKeys({
    declarations,
    sources: corpusData.sources,
    modulesWithCode: corpusData.modulesWithCode,
    libraryModules: corpusData.libraryModules,
    truncated: corpusData.truncated,
    ignorePrefixes: vscode.workspace
      .getConfiguration('kotlinJump')
      .get<string[]>('unusedResourceKeysIgnorePrefixes', []),
  });

  return { findings, truncated: corpusData.truncated };
}

function summarize(findings: readonly UnusedResourceKey[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ');
}

export async function findUnusedResourceKeysCommand(
  corpus: ResourceCorpus,
  provider: UnusedResourceKeyProvider,
): Promise<void> {
  if (!UnusedResourceKeyProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Unused resource key detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unused resource keys.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for unused resource keys…', cancellable: true },
    async (_progress, token) => {
      const result = await scan(corpus, token);
      if (!result) return;

      if (result.truncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no resource key can be proven unused. Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      provider.setFindings(result.findings);
      if (result.findings.length === 0) {
        void vscode.window.showInformationMessage('No unused resource keys found.');
        return;
      }
      void vscode.window.showInformationMessage(
        `${result.findings.length} unused resource keys: ${summarize(result.findings)}.`,
      );
    },
  );
}

/** Every removable key, in one Refactor Preview. */
export async function removeAllUnusedResourceKeysCommand(
  corpus: ResourceCorpus,
  provider: UnusedResourceKeyProvider,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before removing unused resource keys.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Preparing the resource key cleanup…', cancellable: true },
    async (_progress, token) => {
      const result = await scan(corpus, token);
      if (!result) return;

      if (result.truncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so nothing was removed.',
        );
        return;
      }
      if (result.findings.length === 0) {
        void vscode.window.showInformationMessage('No unused resource keys to remove.');
        return;
      }

      provider.setFindings(result.findings);
      const edit = await buildRemovalEdit(result.findings);
      await vscode.workspace.applyEdit(edit);
    },
  );
}
