import * as vscode from 'vscode';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';
import { plural } from '../util/plural';
import { Corpus, ResourceCorpus } from '../indexer/ResourceCorpus';
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
): Promise<{ findings: UnusedResourceKey[]; truncated: boolean; data: Corpus } | undefined> {
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

  return { findings, truncated: corpusData.truncated, data: corpusData };
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
        `${result.findings.length} unused resource key${result.findings.length === 1 ? '' : 's'}: ${summarize(result.findings)}.`,
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
      // Une question, pas une case par fichier.
      const apercu = await buildRemovalEdit(result.findings);
      if (apercu.edits === 0) {
        void vscode.window.showInformationMessage('No unused resource keys to remove.');
        return;
      }
      const choix = await askHowToApply(
        `Remove ${plural(result.findings.length, 'unused resource key')}?`,
        bulkDetail(apercu.edits, apercu.files),
      );
      if (choix === 'cancel') return;
      // The verdict is read again too. `nothing reads this key` is judged over
      // the WHOLE workspace, so what overturns it is almost never the file
      // holding the key: a `R.string.x` that appears while the question is on
      // screen leaves the values file untouched and its cut goes through, and
      // the project stops compiling. Same fix as 1.42.296 through .299.
      //
      // Without paying for the scan twice: the corpus hands back its cached
      // object untouched while nothing has invalidated it.
      let aRetirer = result.findings;
      {
        const frais = await corpus.get(token);
        if (frais !== result.data) {
          const relu = await scan(corpus, token);
          if (!relu || relu.truncated) {
            void vscode.window.showWarningMessage(
              'Could not read the whole workspace, so nothing was removed.');
            return;
          }
          if (relu.findings.length === 0) {
            void vscode.window.showInformationMessage(
              'Nothing to remove: the workspace changed while the question was open.');
            return;
          }
          // The badges follow the new verdict. They were published before the
          // question, and sparing a declaration that came back to life while
          // leaving its `unreferenced` warning on it points the Problems panel
          // at living code and keeps offering to delete it.
          provider.setFindings(relu.findings);
          // An INTERSECTION with what was announced, never a fresh list.
          const annonce = new Set(result.findings.map(f => `${f.kind}\u0000${f.name}`));
          aRetirer = relu.findings.filter(f => annonce.has(`${f.kind}\u0000${f.name}`));
          if (aRetirer.length === 0) {
            void vscode.window.showInformationMessage(
              'Nothing to remove: the workspace changed while the question was open.');
            return;
          }
        }
      }
      // Rebuilt for BOTH answers. Only the flag that opens the preview differs.
      // The preview used to receive the ranges measured BEFORE the question: two
      // lines added at the top of a file during the modal and it showed a cut two
      // lines too high, which the reader can accept in one click. An offset is
      // only worth anything against the text it was measured on, and that holds
      // whether the edit goes out silently or through the preview.
      const choisi = await buildRemovalEdit(aRetirer, undefined, choix === 'review');
      const applique = await vscode.workspace.applyEdit(choisi.edit);
      // L editeur refuse une edition entiere sans un bruit, deux plages qui se
      // chevauchent suffisent, et l apercu ferme sur Discard revient ici de la
      // meme facon. Annoncer la suppression sans lire ce retour donnait une
      // fausse nouvelle sur un fichier intact, ce qui est pire que le silence
      // d avant : le lecteur cesse de chercher. Meme mot que le reste de la
      // famille.
      if (!applique) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }
      // Apply all skips the preview, so nothing else would say what happened.
      void vscode.window.showInformationMessage(
        choix === 'review'
          ? `Sent ${plural(choisi.cles, 'unused resource key')} to the preview.`
          : `Removed ${plural(choisi.cles, 'unused resource key')} in ${plural(choisi.files, 'file')}.`,
      );
    },
  );
}
