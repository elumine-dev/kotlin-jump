import * as vscode from 'vscode';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';
import { plural } from '../util/plural';
import { corpusUri } from '../util/corpusUri';
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
      if (token.isCancellationRequested) return;
      if (data.sourcesTruncated) {
        void vscode.window.showWarningMessage('Could not read the whole workspace, so nothing was removed.');
        return;
      }

      const found = findUnusedRemoteConfigKeys({ sources: data.sources, ...remoteConfigSettings() });
      provider.setFindings(found);
      if (found.length === 0) {
        void vscode.window.showInformationMessage('Nothing to remove.');
        return;
      }

      // Group by file and apply back to front, so an earlier removal never
      // shifts the offsets of a later one.
      const grouper = (cles: readonly UnusedRemoteConfigKey[]) => {
        const par = new Map<string, UnusedRemoteConfigKey['declarations']>();
        for (const key of cles) {
          for (const d of key.declarations) {
            const list = par.get(d.path) ?? [];
            list.push(d);
            par.set(d.path, list);
          }
        }
        return par;
      };
      let byFile = grouper(found);

      // Les offsets viennent du CORPUS. Ils ne valent que contre lui, et la
      // commande les confrontait au disque pour les verifier puis les
      // convertissait en positions via `openTextDocument`, qui rend le TAMPON
      // quand le fichier est ouvert : deux textes pour un seul jeu de bornes.
      // La boite modale posee en 1.42.240 entre la mesure et l'application a
      // elargi la fenetre sans la creer, donc on reconstruit apres la reponse,
      // comme les trois autres commandes de masse.
      let mesures = new Map(data.sources.map(s => [s.path, s.text]));
      const decoder = new TextDecoder();
      const construire = async (confirm: boolean) => {
        const edit = new vscode.WorkspaceEdit();
        let count = 0;
        let bouges = 0;
        const fichiers = new Set<string>();
        const ouverts = new Map(vscode.workspace.textDocuments
          .filter(d => d.uri.scheme === 'file')
          .map(d => [d.uri.fsPath, d]));
        for (const [path, declarations] of byFile) {
          const uri = corpusUri(path);
          const ouvert = ouverts.get(uri.fsPath);
          let vivant: string;
          if (ouvert) {
            vivant = ouvert.getText();
          } else {
            try {
              vivant = decoder.decode(await vscode.workspace.fs.readFile(uri));
            } catch {
              continue;
            }
          }
          if (vivant !== mesures.get(path)) { bouges++; continue; }
          const starts = debutsDeLigne(vivant);
          for (const d of [...declarations].sort((a, b) => b.removeStart - a.removeStart)) {
            // Ceinture : meme sur le bon texte, une borne qui ne couvre pas une
            // cle ne vise pas ce qu'on croit.
            if (!vivant.slice(d.removeStart, d.removeEnd).includes('<key>')) continue;
            edit.delete(uri, new vscode.Range(posAt(starts, d.removeStart), posAt(starts, d.removeEnd)),
              { needsConfirmation: confirm, label: 'Remove unread Remote Config keys' });
            count++;
            fichiers.add(path);
          }
        }
        return { edit, count, bouges, fichiers: fichiers.size };
      };

      const noteDe = (bouges: number) => bouges > 0
        ? ` ${plural(bouges, 'file')} changed since the scan and ${bouges > 1 ? 'were' : 'was'} left alone: run the command again.`
        : '';

      const apercu = await construire(true);
      if (apercu.count === 0) {
        void vscode.window.showInformationMessage(`Nothing to remove.${noteDe(apercu.bouges)}`);
        return;
      }
      const choix = await askHowToApply(
        `Remove ${plural(apercu.count, 'unread Remote Config key')}?`,
        bulkDetail(apercu.count, apercu.fichiers),
      );
      if (choix === 'cancel') return;

      // The verdict is read again too. `nothing reads this key` is judged over
      // the WHOLE workspace, so what overturns it is almost never the file
      // holding the key: a read that appears while the question is on screen
      // leaves the defaults file untouched and its cut goes through, taking a
      // default value the app still asks for. Same fix as 1.42.296 through
      // .300.
      //
      // Without paying for the scan twice: the corpus hands back its cached
      // object untouched while nothing has invalidated it.
      if (choix === 'apply') {
        const frais = await corpus.get(token);
        if (frais !== data) {
          if (frais.sourcesTruncated) {
            void vscode.window.showWarningMessage(
              'Could not read the whole workspace, so nothing was removed.');
            return;
          }
          const relu = findUnusedRemoteConfigKeys({ sources: frais.sources, ...remoteConfigSettings() });
          if (relu.length === 0) {
            void vscode.window.showInformationMessage(
              'Nothing to remove: the workspace changed while the question was open.');
            return;
          }
          // An INTERSECTION with what was announced, never a fresh list.
          const annonce = new Set(found.map(k => k.name));
          const retenues = relu.filter(k => annonce.has(k.name));
          if (retenues.length === 0) {
            void vscode.window.showInformationMessage(
              'Nothing to remove: the workspace changed while the question was open.');
            return;
          }
          byFile = grouper(retenues);
          mesures = new Map(frais.sources.map(s => [s.path, s.text]));
        }
      }
      // Ce qui est applique est ce qui est rapporte.
      const choisi = choix === 'apply' ? await construire(false) : apercu;
      if (choisi.count === 0) {
        void vscode.window.showInformationMessage(`Nothing to remove.${noteDe(choisi.bouges)}`);
        return;
      }
      const applique = await vscode.workspace.applyEdit(choisi.edit);
      // L editeur refuse une edition entiere sans un bruit, deux plages qui se
      // chevauchent suffisent, et l apercu ferme sur Discard revient ici de la
      // meme facon. Annoncer la suppression sans lire ce retour donnait une
      // fausse nouvelle sur un fichier intact, ce qui est pire que le silence
      // d avant : le lecteur cesse de chercher. Meme mot que le reste de la
      // famille.
      // La note sur ce qui a BOUGE ne parle pas de la meme chose et reste vraie :
      // elle dit au lecteur de relancer. Le retour anticipe l'emportait avec le
      // reste, et « Nothing was applied. » tout seul cache que trois fichiers
      // avaient ete laisses de cote pour une autre raison, reparable celle la.
      if (!applique) { void vscode.window.showWarningMessage(`Nothing was applied.${noteDe(choisi.bouges)}`); return; }
      // Apply all skips the preview, so nothing else would say what happened.
      // The note about files that moved rode alone before, without ever
      // saying what had actually gone.
      void vscode.window.showInformationMessage(
        (choix === 'review'
          ? `Sent ${plural(choisi.count, 'unread Remote Config key')} to the preview.`
          : `Removed ${plural(choisi.count, 'unread Remote Config key')} in ${plural(choisi.fichiers, 'file')}.`)
        + noteDe(choisi.bouges),
      );
    },
  );
}

/** Les offsets de debut de chaque ligne, pour convertir sans passer par un document. */
function debutsDeLigne(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts: readonly number[], offset: number): vscode.Position {
  let bas = 0, haut = starts.length - 1;
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    if (starts[milieu] <= offset) bas = milieu; else haut = milieu - 1;
  }
  return new vscode.Position(bas, offset - starts[bas]);
}
