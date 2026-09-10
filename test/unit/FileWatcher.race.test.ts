/**
 * FileWatcher — la suppression qui arrive pendant que le scan est en vol.
 *
 * `flush()` retire le fichier de l'index puis lance `scanner.scanFile(uri)`
 * sans l'attendre. Ce scan fait DEUX await : la lecture, puis un aller retour
 * par le pool de workers pour le parse. La fenêtre est donc large de plusieurs
 * dizaines de millisecondes, pas d'une microtâche.
 *
 * Si la suppression arrive dans cette fenêtre, son `index.remove` ne trouve
 * rien (le flush venait de retirer l'entrée) et l'ajout tardif du scan
 * ressuscite le fichier. Symptôme : Cmd+T liste un fichier effacé et Cmd+click
 * ouvre « file not found », exactement ce que le treeWatcher a été ajouté pour
 * corriger dans le cas d'un dossier.
 *
 * Vecteurs :
 *   FW-7  Suppression pendant un scan normal (≤ 8 fichiers)
 *   FW-8  Suppression pendant une rafale séquentielle
 *   FW-9  Dossier supprimé pendant un scan de l'un de ses fichiers
 *   FW-10 Une modification pendant le scan ne perd pas le contenu final
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

const NL = String.fromCharCode(10);
const SOURCE = (nom: string) => 'package p' + NL + 'class ' + nom + NL;

/** Un scanner dont chaque scan attend une barrière que le test relâche. */
function scannerRetarde(index: SymbolIndex, nom: (uri: vscode.Uri) => string) {
  const enVol: Array<() => void> = [];
  const scanner = {
    scanFile: vi.fn(async (uri: vscode.Uri) => {
      await new Promise<void>(r => enVol.push(r));
      index.add(parse(uri.toString(), SOURCE(nom(uri))));
      index.finalize();
    }),
    scanFiles: vi.fn(async () => {}),
  } as any;
  return { scanner, liberer: () => { const t = [...enVol]; enVol.length = 0; t.forEach(r => r()); } };
}

const uriOf = (n: number) => vscode.Uri.parse(`file:///proj/src/File${n}.kt`) as any;

let watcher: FileWatcher | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { watcher?.dispose(); watcher = undefined; vi.useRealTimers(); });

async function tourner(): Promise<void> {
  for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(200);
}

describe('FW-7 — suppression pendant un scan normal', () => {
  it('le fichier supprimé ne revient pas dans l index', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, () => 'Fantome');
    watcher = new FileWatcher(scanner, index);

    (watcher as any).queue(uriOf(1));
    await vi.advanceTimersByTimeAsync(200);   // le flush part, le scan est en vol
    expect(scanner.scanFile).toHaveBeenCalledTimes(1);

    (watcher as any).onDeleted(uriOf(1));     // suppression PENDANT le vol
    liberer();
    await tourner();

    expect(index.lookup('Fantome')).toHaveLength(0);
    expect(index.stats().files).toBe(0);
  });
});

describe('FW-8 — suppression pendant une rafale', () => {
  it('le fichier supprimé en cours de rafale ne revient pas', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, uri => 'C' + (uri.path.match(/File(\d+)/)?.[1] ?? 'X'));
    watcher = new FileWatcher(scanner, index, undefined, undefined, () => {});

    for (let i = 0; i < 12; i++) (watcher as any).queue(uriOf(i));
    await vi.advanceTimersByTimeAsync(200);   // la rafale demarre, premier scan en vol

    (watcher as any).onDeleted(uriOf(0));
    for (let i = 0; i < 40; i++) { liberer(); await vi.advanceTimersByTimeAsync(50); }

    expect(index.lookup('C0'), 'le fichier 0 a ete supprime').toHaveLength(0);
    expect(index.lookup('C5').length, 'les autres restent indexes').toBeGreaterThan(0);
  });
});

describe('FW-9 — dossier supprimé pendant un scan', () => {
  it('aucun fichier du dossier effacé ne survit', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, () => 'DansLeDossier');
    watcher = new FileWatcher(scanner, index);

    (watcher as any).queue(uriOf(3));
    await vi.advanceTimersByTimeAsync(200);
    watcher.removeTree(vscode.Uri.parse('file:///proj/src') as any);
    liberer();
    await tourner();

    expect(index.lookup('DansLeDossier')).toHaveLength(0);
  });
});

describe('FW-10 — la garde ne perd pas une modification légitime', () => {
  it('un fichier réécrit pendant son scan finit indexé avec le contenu final', async () => {
    const index = new SymbolIndex();
    let nom = 'Avant';
    const { scanner, liberer } = scannerRetarde(index, () => nom);
    watcher = new FileWatcher(scanner, index);

    (watcher as any).queue(uriOf(7));
    await vi.advanceTimersByTimeAsync(200);   // premier scan en vol
    nom = 'Apres';
    (watcher as any).queue(uriOf(7));         // nouvelle modification pendant le vol
    liberer();
    await tourner();
    liberer();
    await tourner();

    expect(index.lookup('Avant'), 'le resultat perime est jete').toHaveLength(0);
    expect(index.lookup('Apres'), 'le second scan fait foi').toHaveLength(1);
  });
});
