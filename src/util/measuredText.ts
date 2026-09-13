import * as vscode from 'vscode';
import { corpusUri } from './corpusUri';

/**
 * An offset is only valid against the text it was measured on.
 *
 * `isDirty` answers a different question: it says whether the EDITOR changed
 * the document, not whether the document is still what the scan read. A file
 * reloaded from disk by a checkout, a stash pop or another tool comes back
 * CLEAN with new content, and the corpus keeps its copy for a minute. An edit
 * placed with the old offsets then lands on the wrong lines.
 *
 * Returns the measured text when it is still what an edit would land in, and
 * undefined when the caller must skip this file.
 */
/**
 * Le document QUI EST ce fichier, pas celui qui porte le meme chemin.
 *
 * Une vue de comparaison ouvre un document `git:` dont le `fsPath` est celui du
 * vrai fichier et dont le contenu est celui de HEAD. Le reconnaitre par son
 * seul chemin revient a lire HEAD et a ecrire dans l'arbre de travail.
 *
 * Le schema attendu est celui sous lequel le CORPUS a lu ce fichier, pas
 * `file` en dur. Sur vscode.dev un fichier est un
 * `vscode-vfs://github/owner/repo/...`, que la liste blanche ecartait au meme
 * titre que `git:`. Tout ce qui en decoule echouait alors en s'ouvrant, ce qui
 * est le mauvais sens pour un garde-fou : `stillTheMeasuredText` concluait
 * « rien n'est ouvert » et rendait le texte mesure sans le confronter a
 * l'editeur, et les deux fournisseurs qui preferent le texte de l'editeur a
 * celui du disque lisaient le disque. Un chemin que le corpus n'a jamais vu
 * retombe sur `file`, donc rien ne change hors de ce cas.
 */
export function estLeFichier(path: string) {
  const attendu = corpusUri(path);
  return (d: vscode.TextDocument): boolean =>
    d.uri.scheme === attendu.scheme && d.uri.fsPath === path;
}

export function stillTheMeasuredText(
  path: string,
  measured: string | undefined,
): string | undefined {
  if (measured === undefined) return undefined;
  const open = vscode.workspace.textDocuments.find(estLeFichier(path));
  if (open === undefined) return measured;   // nothing open: the disk copy is what we read
  return open.getText() === measured ? measured : undefined;
}
