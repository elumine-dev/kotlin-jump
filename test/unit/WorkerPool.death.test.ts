/**
 * Le pool de parse quand son fichier worker manque.
 *
 * `new Worker(chemin)` ne lève PAS pour un fichier absent : Node signale
 * l'échec plus tard, par un événement `error` (MODULE_NOT_FOUND) puis `exit`.
 * Le constructeur du pool était enveloppé dans un try/catch commenté « worker
 * file not found, fall back to inline parsing », un repli qui ne s'activait
 * donc jamais. Pire, `onError` remettait le worker mort dans le vivier, et le
 * `postMessage` suivant partait dans le vide : Node l'accepte sans erreur et
 * la réponse ne vient jamais.
 *
 * Conséquence pour l'utilisateur : un `dist/parser-worker.js` absent ou mis en
 * quarantaine, et chaque parse Kotlin reste en suspens pour toujours. L'index
 * ne se remplit pas, sans un message.
 *
 * Ici `__dirname` est `src/indexer`, où il n'y a que le `.ts` : le pool y
 * trouve donc réellement un fichier worker manquant, sans simulation.
 */
import { describe, it, expect } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { WorkerPool } from '../../src/indexer/WorkerPool';
import { FileScanner } from '../../src/indexer/FileScanner';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

const NL = String.fromCharCode(10);

/** Laisse passer les événements error/exit des workers. */
async function laisserMourir(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>(r => setTimeout(r, 25));
}

describe('WorkerPool — le fichier worker est introuvable', () => {
  it('ne se declare plus disponible une fois ses workers morts', async () => {
    const pool = new WorkerPool(2);
    await laisserMourir();
    expect(pool.available, 'un pool sans worker vivant n est pas disponible').toBe(false);
    await pool.destroy();
  });

  it('rejette au lieu de rester en suspens pour toujours', async () => {
    const pool = new WorkerPool(2);
    await laisserMourir();
    // Le vrai symptôme : cette promesse ne se résolvait jamais.
    const course = Promise.race([
      pool.run('file:///x.kt', 'package p' + NL + 'class A').then(() => 'resolu', () => 'rejete'),
      new Promise<string>(r => setTimeout(() => r('EN SUSPENS'), 1500)),
    ]);
    await expect(course).resolves.not.toBe('EN SUSPENS');
    await pool.destroy();
  });

  it('rejette aussi ce qui attendait dans la file quand le dernier worker meurt', async () => {
    const pool = new WorkerPool(1);
    // Lancé AVANT la mort : deux travaux, dont un en file d'attente.
    const premier = pool.run('file:///a.kt', 'class A').then(() => 'resolu', () => 'rejete');
    const enFile  = pool.run('file:///b.kt', 'class B').then(() => 'resolu', () => 'rejete');
    const verdict = await Promise.race([
      Promise.all([premier, enFile]),
      new Promise<string[]>(r => setTimeout(() => r(['EN SUSPENS', 'EN SUSPENS']), 2000)),
    ]);
    expect(verdict, 'aucun travail ne doit rester en suspens').toEqual(['rejete', 'rejete']);
    await pool.destroy();
  });
});

describe('FileScanner — pool hors service', () => {
  it('indexe quand meme le fichier, par le parse en ligne', async () => {
    const index = new SymbolIndex();
    const journal = { info() {}, debug() {}, warn() {}, error() {} } as any;
    const scanner = new FileScanner(index, journal, new Map());
    // Le pool de ce scanner cherche `parser-worker.js` a cote du source : il
    // n'y est pas, donc ses workers meurent. C'est exactement ce qu'un VSIX
    // ampute ou un antivirus produisent.
    await laisserMourir();
    expect((scanner as any).pool.available, 'le pool est bien hors service').toBe(false);

    const uri = vscodeMock.Uri.parse('file:///p/Repli.kt');
    const orig = (vscodeMock.workspace.fs as any).readFile;
    (vscodeMock.workspace.fs as any).readFile = async () =>
      new TextEncoder().encode('package p' + NL + 'class Repli' + NL);
    try {
      const course = Promise.race([
        scanner.scanFile(uri as any).then(() => 'fini'),
        new Promise<string>(r => setTimeout(() => r('EN SUSPENS'), 2000)),
      ]);
      expect(await course, 'le scan ne doit pas rester en suspens').toBe('fini');
    } finally {
      (vscodeMock.workspace.fs as any).readFile = orig;
    }
    index.finalize();

    expect(index.lookup('Repli'), 'le fichier est indexe malgre le pool mort').toHaveLength(1);
    await scanner.destroy();
  });
});

describe('FileScanner — le worker meurt pendant la course', () => {
  it('un pool qui se dit disponible puis rejette bascule en ligne', async () => {
    const index = new SymbolIndex();
    const journal = { info() {}, debug() {}, warn() {}, error() {} } as any;
    const scanner = new FileScanner(index, journal, new Map());
    // La fenetre etroite : `available` est vrai au moment du test, et le
    // worker meurt avant de repondre. Sans le repli, le fichier n'est pas
    // indexe du tout.
    let appels = 0;
    (scanner as any).pool = {
      available: true,
      run: async () => { appels++; throw new Error('worker mort en vol'); },
      destroy: async () => {},
    };

    const uri = vscodeMock.Uri.parse('file:///p/Course.kt');
    const orig = (vscodeMock.workspace.fs as any).readFile;
    (vscodeMock.workspace.fs as any).readFile = async () =>
      new TextEncoder().encode('package p' + NL + 'class Course' + NL);
    try {
      await scanner.scanFile(uri as any);
    } finally {
      (vscodeMock.workspace.fs as any).readFile = orig;
    }
    index.finalize();

    expect(appels, 'le pool a bien ete tente').toBe(1);
    expect(index.lookup('Course'), 'et le parse en ligne a pris le relais').toHaveLength(1);
  });
});
