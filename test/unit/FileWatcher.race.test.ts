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
 *   FW-11 addTree jette les fichiers dépassés par un événement
 *   FW-12 addTree ne balaie pas une grande liste par fichier (le tri était quadratique)
 *   FW-13 removeTree ne parcourt pas tout l'historique des fichiers vus
 *   FW-14 Dossier supprimé avant que la file d'attente ait été vidée
 *   FW-15 Dossier supprimé pendant le balayage initial, qui ignore le veilleur
 *   FW-16 Une vague de suppressions pendant un balayage ne fait qu'une reprise
 *   FW-17 Deux scans du même fichier qui se chevauchent ne s'effacent pas
 *   FW-18 Invariant global : après une tempête d'événements, index == disque
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { FileScanner } from '../../src/indexer/FileScanner';

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
    // Les marques de suppression ne servent qu'a departager les scans en vol.
    // Sans cette borne, l'ensemble grossit d'une entree par fichier supprime
    // pendant toute la session, ce qui est le defaut que la carte d'epoques
    // avait deja eu.
    expect((watcher as any).supprimes.size, 'les marques sont liberees une fois les scans finis').toBe(0);
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

describe('FW-11 — addTree jette ce qu un evenement a depasse', () => {
  it('un fichier supprimé pendant le scan du dossier n est pas indexé', async () => {
    vi.useRealTimers();
    const index = new SymbolIndex();
    const uris = [uriOf(1), uriOf(2), uriOf(3)];
    (vscode.workspace as any).findFiles = async () => uris;
    let pendant: (() => void) | undefined;
    const scanner = {
      scanFile: vi.fn(async () => {}),
      scanFiles: vi.fn(async (us: vscode.Uri[]) => {
        pendant?.();                                  // suppression EN PLEIN scan du lot
        for (const u of us) { index.add(parse(u.toString(), SOURCE('D' + u.path.match(/File(\d+)/)![1]))); }
        index.finalize();
      }),
    } as any;
    const w = new FileWatcher(scanner, index);
    pendant = () => (w as any).onDeleted(uriOf(2));
    await w.addTree(vscode.Uri.parse('file:///proj/autre') as any);
    // Avant dispose(), qui vide l'ensemble et rendrait l'assertion suivante creuse.
    expect((w as any).enVol.size, 'le lot ne doit rien laisser marqué en vol').toBe(0);
    w.dispose();

    expect(index.lookup('D2'), 'le fichier supprimé pendant le lot est jeté').toHaveLength(0);
    expect(index.lookup('D1').length, 'les autres restent').toBeGreaterThan(0);
  });
});

describe('FW-12 — addTree ne balaie pas une grande liste dans une boucle', () => {
  it('trie 30 000 survivants sans un seul balayage lineaire', async () => {
    vi.useRealTimers();
    const uris = Array.from({ length: 30_000 }, (_, i) => vscode.Uri.parse('file:///big/F' + i + '.kt'));
    (vscode.workspace as any).findFiles = async () => uris;

    // Un fichier est dépassé PENDANT le scan du lot. Sans lui, « zéro
    // balayage » serait aussi ce que compte un addTree qui ne fait rien : le
    // test passait sur un addTree vidé comme sur un tri supprimé.
    const boite: { w?: FileWatcher } = {};
    const scanner = {
      scanFile: async () => {},
      scanFiles: vi.fn(async () => { (boite.w as any).onDeleted(uris[7]); }),
    } as any;
    let notifies: vscode.Uri[] = [];
    const w = new FileWatcher(scanner, new SymbolIndex(), undefined, undefined, us => { notifies = us; });
    boite.w = w;

    // Le defaut livre en v1.42.109 etait `vivants.includes(u)` dans une boucle
    // sur `uris` : quadratique, et comme rien ne bouge dans le cas courant, le
    // cas courant etait le pire cas. Un budget d'horloge ne tient pas ce role,
    // il a echoue a 60 ms contre 50 des que la machine s'est chargee. On
    // compte donc les balayages, ce qu'aucune charge ne fait varier.
    const noms = ['includes', 'indexOf', 'lastIndexOf'] as const;
    const origines = { includes: Array.prototype.includes, indexOf: Array.prototype.indexOf, lastIndexOf: Array.prototype.lastIndexOf };
    let balayages = 0;
    for (const nom of noms) {
      const origine = origines[nom];
      (Array.prototype as any)[nom] = function (this: unknown[], ...args: unknown[]) {
        if (Array.isArray(this) && this.length > 1_000) balayages++;
        return (origine as any).apply(this, args);
      };
    }
    try {
      await w.addTree(vscode.Uri.parse('file:///big2') as any);
    } finally {
      for (const nom of noms) (Array.prototype as any)[nom] = origines[nom];
      w.dispose();
    }

    expect(scanner.scanFiles).toHaveBeenCalledTimes(1);
    expect(notifies, 'le tri a bien tourné et a jeté le fichier dépassé').toHaveLength(29_999);
    expect(balayages, 'un balayage lineaire par fichier redonne un quadratique').toBe(0);
  });
});

describe('FW-13 — removeTree ne relit pas tout l historique', () => {
  it('attrape le scan en vol sans parcourir les fichiers deja vus', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, () => 'DansLeDossier');
    watcher = new FileWatcher(scanner, index);

    // Une session de travail : beaucoup de fichiers ont eu un evenement.
    for (let i = 0; i < 3_000; i++) (watcher as any).noterSuppression(uriOf(1000 + i));

    (watcher as any).queue(uriOf(3));
    await vi.advanceTimersByTimeAsync(200);        // le scan de File3 est en vol

    // `removeTree` avait besoin de repérer ce scan en vol, et le faisait en
    // relisant toute la carte des époques : 406 ms pour 200 suppressions de
    // dossier une fois 50 000 fichiers vus. Cette carte a disparu ; la garde
    // vise maintenant `supprimes`, le seul ensemble du veilleur qui puisse
    // encore grossir avec la session.
    const historique: Set<string> = (watcher as any).supprimes;
    let parcours = 0;
    (watcher as any).supprimes = new Proxy(historique, {
      get(cible, prop) {
        if (prop === 'keys' || prop === 'values' || prop === 'entries' || prop === 'forEach' || prop === Symbol.iterator) parcours++;
        const v = Reflect.get(cible, prop, cible);
        return typeof v === 'function' ? v.bind(cible) : v;
      },
    });

    watcher.removeTree(vscode.Uri.parse('file:///proj/src') as any);
    liberer();
    await tourner();

    // D'abord la garde fait son travail, sinon « zéro parcours » ne prouve rien.
    expect(index.lookup('DansLeDossier'), 'le scan en vol est bien attrapé').toHaveLength(0);
    expect(parcours, 'aucun ensemble a croissance libre ne doit etre parcouru').toBe(0);
    // Sans cette ligne, un ensemble qui ne se vide jamais redevient tout
    // l'historique et ramène le parcours par une autre porte.
    expect((watcher as any).enVol.size, 'aucun scan ne doit rester marqué en vol').toBe(0);
  });
});

describe('FW-14 — dossier supprime avant le flush', () => {
  it('un fichier encore en file d attente n est pas scanne apres coup', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, () => 'JamaisNe');
    watcher = new FileWatcher(scanner, index);

    // Un fichier tout neuf : jamais indexé, et son scan n'a pas encore démarré
    // puisque la fenêtre d'anti rebond court toujours.
    (watcher as any).queue(uriOf(42));
    expect((watcher as any).pendingScan.size, 'le fichier attend bien son flush').toBe(1);

    watcher.removeTree(vscode.Uri.parse('file:///proj/src') as any);

    await vi.advanceTimersByTimeAsync(300);   // le flush aurait lieu ici
    liberer();
    await tourner();

    expect(scanner.scanFile, 'un dossier effacé ne doit plus rien faire scanner').not.toHaveBeenCalled();
    expect(index.lookup('JamaisNe')).toHaveLength(0);
  });
});

describe('FW-15 — dossier supprime pendant le balayage initial', () => {
  it('le fichier ajoute apres coup par le balayage est repris', async () => {
    vi.useRealTimers();
    const index = new SymbolIndex();
    const journal = { info() {}, debug() {}, warn() {}, error() {} } as any;
    // Le vrai scanner : c'est lui qui ajoute a l'index sans passer par le
    // veilleur. Un .java pour rester en parse inline, hors pool de workers.
    const scanner = new FileScanner(index, journal, new Map());
    const w = new FileWatcher(scanner as any, index);
    // Imbriqué : la reprise doit remonter les parents pour le rattacher au
    // dossier supprimé. Posé à la racine, un test passerait même si la reprise
    // n'examinait que le dossier direct.
    const cible = vscode.Uri.parse('file:///proj/src/sub/plus/loin/Perdu.java');

    let suppressions = 0;
    const vraiRemove = w.removeTree.bind(w);
    (w as any).removeTree = (f: vscode.Uri) => { suppressions++; return vraiRemove(f); };

    const origRead = (vscode.workspace.fs as any).readFile;
    (vscode.workspace.fs as any).readFile = async (u: any) => {
      if (String(u.toString()) !== cible.toString()) throw new Error('absent');
      // Le dossier disparait pendant que ce fichier est lu : il n'est ni dans
      // l'index, ni dans la file, ni dans les scans en vol du veilleur.
      (w as any).removeTree(vscode.Uri.parse('file:///proj/src'));
      return new TextEncoder().encode('package p;' + NL + 'public class Ressuscite {}' + NL);
    };
    try {
      await scanner.scanFiles([cible as any]);
      index.finalize();
      expect((w as any).enVol.size, 'le veilleur ne voit rien de ce balayage').toBe(0);
      await new Promise<void>(r => setTimeout(r, 0));   // le rejeu est une micro tache
    } finally {
      (vscode.workspace.fs as any).readFile = origRead;
      w.dispose();
    }

    expect(index.lookup('Ressuscite'), 'le rejeu reprend le fichier').toHaveLength(0);
    // Le rejeu passe par une reprise groupee, pas par un second removeTree :
    // un rappel par dossier relisait tout l'index a chaque fois.
    expect(suppressions, 'un seul appel a removeTree, pas de recursion').toBe(1);
    expect((w as any).aRejouer.size, 'la file de reprise est videe').toBe(0);
    expect((w as any).rejeuArme, 'plus aucune reprise armee').toBe(false);
    expect((scanner as any).actifs, 'le compteur d activite revient a zero').toBe(0);

    // Temoin : le meme balayage, sans suppression de dossier, indexe bien le
    // fichier. Sans lui, un zero pourrait venir d'un harnais casse plutot que
    // du rejeu, ce qui est exactement le piege des deux ticks precedents.
    const temoinIndex = new SymbolIndex();
    const temoin = new FileScanner(temoinIndex, journal, new Map());
    const origRead2 = (vscode.workspace.fs as any).readFile;
    (vscode.workspace.fs as any).readFile = async () =>
      new TextEncoder().encode('package p;' + NL + 'public class Ressuscite {}' + NL);
    try {
      await temoin.scanFiles([cible as any]);
      temoinIndex.finalize();
    } finally {
      (vscode.workspace.fs as any).readFile = origRead2;
    }
    expect(temoinIndex.lookup('Ressuscite'), 'le balayage indexe bien ce fichier').toHaveLength(1);
  });
});

describe('FW-16 — une vague de suppressions ne fait qu une reprise', () => {
  it('200 dossiers supprimes pendant un balayage : un seul whenIdle, un seul parcours', async () => {
    vi.useRealTimers();
    const index = new SymbolIndex();
    // Moitié à la racine du dossier, moitié dans des sous dossiers : sans les
    // seconds, la remontée de parents n'est jamais exercée et un test qui
    // n'examine que le dossier direct passerait aussi.
    for (let i = 0; i < 400; i++) {
      const dossier = 'file:///w/d' + (i % 200);
      const chemin = i % 2 === 0 ? dossier + '/F' + i + '.kt' : dossier + '/sub/plus/loin/F' + i + '.kt';
      index.add(parse(chemin, SOURCE('S' + i)));
    }
    index.finalize();

    let liberer!: () => void;
    const balayage = new Promise<void>(r => { liberer = r; });
    let actif = true;
    let appelsWhenIdle = 0;
    const scanner = {
      scanFile: async () => {}, scanFiles: async () => {},
      busy: () => actif,
      whenIdle: () => { appelsWhenIdle++; return balayage; },
    } as any;
    const w = new FileWatcher(scanner, index);

    for (let d = 0; d < 200; d++) w.removeTree(vscode.Uri.parse('file:///w/d' + d) as any);
    expect((w as any).aRejouer.size, 'les 200 dossiers attendent la fin du balayage').toBe(200);
    expect(appelsWhenIdle, 'un seul rappel arme pour toute la vague').toBe(1);

    actif = false; liberer();
    await new Promise<void>(r => setTimeout(r, 0));

    expect((w as any).aRejouer.size, 'la file est videe par la reprise').toBe(0);
    expect(index.stats().files, 'tous les fichiers des dossiers morts sont partis').toBe(0);
    w.dispose();
  });
});

describe('FW-17 — deux scans du meme fichier qui se chevauchent', () => {
  it('une sauvegarde pendant un scan ne fait pas disparaitre le fichier', async () => {
    const index = new SymbolIndex();
    const { scanner, liberer } = scannerRetarde(index, () => 'Sauvegarde');
    watcher = new FileWatcher(scanner, index);

    (watcher as any).queue(uriOf(9));
    await vi.advanceTimersByTimeAsync(200);   // scan 1 en vol
    (watcher as any).queue(uriOf(9));
    await vi.advanceTimersByTimeAsync(200);   // scan 2 en vol, scan 1 toujours dedans
    expect(scanner.scanFile, 'les deux scans se chevauchent bien').toHaveBeenCalledTimes(2);

    liberer();
    await tourner();
    liberer();
    await tourner();

    // Le scan 1 etait perime, mais rien n'a ete supprime : le retirer aurait
    // efface l'ajout du scan 2.
    expect(index.lookup('Sauvegarde'), 'le fichier reste indexe').toHaveLength(1);
  });
});

describe('FW-18 — invariant global apres une tempete', () => {
  it('l index vaut exactement le disque, creations suppressions et dossiers meles', async () => {
    vi.useRealTimers();
    const disque = new Map<string, string>();
    const index = new SymbolIndex();
    const chemin = (d: number, f: number) => 'file:///t/d' + d + '/sub/F' + d + '_' + f + '.kt';

    const scanner = {
      scanFile: async (u: any) => {
        const cle = u.toString();
        await Promise.resolve();
        const t = disque.get(cle);
        if (t === undefined) { index.remove(u); return; }
        await Promise.resolve();
        index.add(parse(cle, t));
        index.finalize();
      },
      scanFiles: async (us: any[]) => { for (const u of us) await (scanner as any).scanFile(u); },
    } as any;
    const w = new FileWatcher(scanner, index);

    for (let d = 0; d < 12; d++) for (let f = 0; f < 4; f++) disque.set(chemin(d, f), SOURCE('C' + d + '_' + f));
    for (const [c, t] of disque) index.add(parse(c, t));
    index.finalize();

    let graine = 20260910;
    const alea = (n: number) => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine % n; };
    const enCours: Promise<void>[] = [];
    for (let etape = 0; etape < 600; etape++) {
      const d = alea(12), f = alea(4), c = chemin(d, f);
      switch (alea(6)) {
        case 0: disque.set(c, SOURCE('C' + d + '_' + f)); (w as any).queue(vscode.Uri.parse(c)); break;
        case 1: case 4: disque.delete(c); (w as any).onDeleted(vscode.Uri.parse(c)); break;
        case 2: {
          const p = 'file:///t/d' + d + '/';
          for (const k of [...disque.keys()]) if (k.startsWith(p)) disque.delete(k);
          w.removeTree(vscode.Uri.parse('file:///t/d' + d) as any);
          break;
        }
        default: enCours.push((async () => { await (w as any).flush(); })());
      }
    }
    await (w as any).flush();
    await Promise.all(enCours);
    for (let i = 0; i < 40; i++) await new Promise<void>(r => setTimeout(r, 0));
    index.finalize();

    const indexes = new Set(index.fileUriStrings());
    const surDisque = new Set(disque.keys());
    expect(surDisque.size, 'la tempete a bien supprime des fichiers').toBeLessThan(48);
    expect(surDisque.size, 'et pas tout').toBeGreaterThan(0);
    expect([...indexes].filter(k => !surDisque.has(k)), 'aucun fantome').toEqual([]);
    expect([...surDisque].filter(k => !indexes.has(k)), 'aucun manquant').toEqual([]);
    w.dispose();
  });
});
