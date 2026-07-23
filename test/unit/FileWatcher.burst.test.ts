/**
 * FileWatcher — coalescing de rafale (le bug « git de VS Code qui rame »)
 *
 * Un checkout git change des centaines de .kt d'un coup. L'ancien debounce
 * PAR FICHIER faisait expirer N timers simultanément : N scans parallèles,
 * N refreshs du test tree, extension host saturé pendant que git tourne.
 *
 * Vecteurs :
 *   FW-1  Petite édition (≤ 8 fichiers) → scans déclenchés, notification par fichier
 *   FW-2  Rafale (> 8) → scans séquentiels + onBurstIndexed UNE fois,
 *         onFileIndexed jamais appelé
 *   FW-3  La fenêtre glissante : des événements espacés de < debounce
 *         repoussent le flush (un seul batch pour toute la tempête)
 *   FW-4  Même fichier changé 3 fois pendant la rafale → scanné UNE fois
 *   FW-5  Fichier supprimé pendant la fenêtre → retiré du batch
 *   FW-6  Sans onBurstIndexed (entrée web) → fallback onFileIndexed par fichier
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

function makeScanner() {
  const scanned: string[] = [];
  return {
    scanned,
    scanner: {
      scanFile: vi.fn(async (uri: vscode.Uri) => { scanned.push(uri.toString()); }),
    } as any,
  };
}

function uriOf(n: number): vscode.Uri {
  return vscode.Uri.parse(`file:///proj/src/File${n}.kt`) as any;
}

let watcher: FileWatcher | undefined;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  watcher?.dispose();
  watcher = undefined;
  vi.useRealTimers();
});

async function flushTimersAndTasks(): Promise<void> {
  // Burst mode interleaves setTimeout(0) yields with awaits — advance until quiet.
  for (let i = 0; i < 50; i++) { await vi.advanceTimersByTimeAsync(200); }
}

describe('FW-1 — petite édition', () => {
  it('3 fichiers → 3 scans, notification par fichier, pas de burst', async () => {
    const { scanner, scanned } = makeScanner();
    const perFile: string[] = [];
    const bursts: number[] = [];
    watcher = new FileWatcher(scanner, new SymbolIndex(),
      uri => perFile.push(uri.toString()), undefined,
      uris => bursts.push(uris.length));

    for (let i = 0; i < 3; i++) (watcher as any).queue(uriOf(i));
    await flushTimersAndTasks();

    expect(scanned).toHaveLength(3);
    expect(perFile).toHaveLength(3);
    expect(bursts).toHaveLength(0);
  });
});

describe('FW-2 — rafale', () => {
  it('50 fichiers → 50 scans, onBurstIndexed une fois, zéro per-file', async () => {
    const { scanner, scanned } = makeScanner();
    const perFile: string[] = [];
    const bursts: number[] = [];
    watcher = new FileWatcher(scanner, new SymbolIndex(),
      uri => perFile.push(uri.toString()), undefined,
      uris => bursts.push(uris.length));

    for (let i = 0; i < 50; i++) (watcher as any).queue(uriOf(i));
    await flushTimersAndTasks();

    expect(scanned).toHaveLength(50);
    expect(perFile).toHaveLength(0);
    expect(bursts).toEqual([50]);
  });
});

describe('FW-3 — fenêtre glissante', () => {
  it('des événements espacés de 100 ms < debounce 150 ms → un seul flush', async () => {
    const { scanner, scanned } = makeScanner();
    const bursts: number[] = [];
    watcher = new FileWatcher(scanner, new SymbolIndex(), undefined, undefined,
      uris => bursts.push(uris.length));

    // 12 événements espacés de 100 ms : la tempête dure 1,2 s mais aucun
    // flush ne part avant le silence
    for (let i = 0; i < 12; i++) {
      (watcher as any).queue(uriOf(i));
      await vi.advanceTimersByTimeAsync(100);
      expect(scanned).toHaveLength(0);
    }
    await flushTimersAndTasks();
    expect(bursts).toEqual([12]);
  });
});

describe('FW-4 — déduplication', () => {
  it('même fichier changé 3 fois → un seul scan', async () => {
    const { scanner, scanned } = makeScanner();
    watcher = new FileWatcher(scanner, new SymbolIndex());
    (watcher as any).queue(uriOf(1));
    (watcher as any).queue(uriOf(1));
    (watcher as any).queue(uriOf(1));
    await flushTimersAndTasks();
    expect(scanned).toHaveLength(1);
  });
});

describe('FW-5 — suppression pendant la fenêtre', () => {
  it('le fichier supprimé sort du batch', async () => {
    const { scanner, scanned } = makeScanner();
    watcher = new FileWatcher(scanner, new SymbolIndex());
    (watcher as any).queue(uriOf(1));
    (watcher as any).queue(uriOf(2));
    (watcher as any).onDeleted(uriOf(1));
    await flushTimersAndTasks();
    expect(scanned).toEqual([uriOf(2).toString()]);
  });
});

describe('FW-6 — fallback sans onBurstIndexed', () => {
  it('rafale sans callback burst → onFileIndexed par fichier quand même', async () => {
    const { scanner } = makeScanner();
    const perFile: string[] = [];
    watcher = new FileWatcher(scanner, new SymbolIndex(),
      uri => perFile.push(uri.toString()));
    for (let i = 0; i < 20; i++) (watcher as any).queue(uriOf(i));
    await flushTimersAndTasks();
    expect(perFile).toHaveLength(20);
  });
});
