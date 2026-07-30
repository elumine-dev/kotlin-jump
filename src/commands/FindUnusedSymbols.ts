import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnusedSymbol,
  UnusedSymbolProvider,
  buildSymbolRemovalEdit,
  findUnusedSymbols,
} from '../providers/UnusedSymbolProvider';

/**
 * KJ-032 commands.
 *
 * Deliberately NOT folded into KJ-030's "Find Dead Code": that sweep drops a
 * file's findings the moment the file is opened, because five live per-file
 * providers take over. KJ-032 has no live provider, so the warning would
 * vanish exactly when the user opens the file to inspect it. The two also
 * disagree on truncation, KJ-032 having to return nothing at all.
 */

const KIND_ORDER = ['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum', 'fun', 'composable', 'val', 'var'];

function settings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    testSourceSets: cfg.get<string[]>('testSourceSets', ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest']),
    ignoreNames: cfg.get<string[]>('unusedSymbolsIgnoreNames', []),
    ignorePaths: cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']),
    includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
    frameworkNameSuffixes: cfg.get<boolean>('unusedSymbolsFrameworkNameSuffixes', false),
  };
}

async function scan(
  corpus: ResourceCorpus,
  token?: vscode.CancellationToken,
): Promise<{ findings: UnusedSymbol[]; truncated: boolean; files: number } | undefined> {
  const data = await corpus.get(token);
  if (token?.isCancellationRequested) return undefined;

  const publishedModules = data.moduleDirs.filter(dir =>
    data.sources.some(s => s.path.startsWith(`${dir}/build.gradle`)
      && /maven-publish|com\.vanniktech\.maven\.publish/.test(s.text)));

  const findings = findUnusedSymbols({
    sources: data.sources,
    publishedModules,
    libraryModules: data.libraryModules,
    truncated: data.sourcesTruncated,
    ...settings(),
  });

  return { findings, truncated: data.sourcesTruncated, files: data.sources.length };
}

function summarize(findings: readonly UnusedSymbol[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ');
}

export async function findUnusedSymbolsCommand(
  corpus: ResourceCorpus,
  provider: UnusedSymbolProvider,
): Promise<void> {
  if (!UnusedSymbolProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Unreferenced symbol detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unreferenced symbols.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for unreferenced symbols…', cancellable: true },
    async (_progress, token) => {
      const result = await scan(corpus, token);
      if (!result) return;

      if (result.truncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so no symbol can be proven unreferenced. Raise kotlinJump.maxIndexedFiles or narrow kotlinJump.excludePatterns.',
        );
        return;
      }

      provider.setFindings(result.findings);
      const unreferenced = result.findings.filter(f => f.verdict === 'unreferenced');
      const testOnly = result.findings.filter(f => f.verdict === 'testOnly');

      if (result.findings.length === 0) {
        void vscode.window.showInformationMessage(
          `No unreferenced top-level symbols across ${result.files} files.`,
        );
        return;
      }
      const testNote = testOnly.length > 0 ? ` and ${testOnly.length} used only from tests` : '';
      void vscode.window.showInformationMessage(
        `${unreferenced.length} unreferenced top-level symbols (${summarize(unreferenced)})${testNote}, across ${result.files} files.`,
      );
    },
  );
}

/** Every removable finding, in one Refactor Preview. */
export async function removeAllUnusedSymbolsCommand(
  corpus: ResourceCorpus,
  provider: UnusedSymbolProvider,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before removing unreferenced symbols.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Preparing the unreferenced symbol cleanup…', cancellable: true },
    async (_progress, token) => {
      const result = await scan(corpus, token);
      if (!result) return;

      if (result.truncated) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so nothing was removed.',
        );
        return;
      }

      provider.setFindings(result.findings);
      // Test-only findings never carry a removal: deleting them breaks the
      // tests that exercise them, and that call is the reader's to make.
      const removable = result.findings.filter(f => f.verdict === 'unreferenced' && f.removeStart !== -1);
      if (removable.length === 0) {
        void vscode.window.showInformationMessage('Nothing to remove automatically.');
        return;
      }
      await vscode.workspace.applyEdit(await buildSymbolRemovalEdit(removable));
    },
  );
}
