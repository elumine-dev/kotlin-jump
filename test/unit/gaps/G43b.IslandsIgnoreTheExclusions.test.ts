import { describe, it, expect } from 'vitest';
import { findDeadIslands } from '../../../src/providers/deadIslands';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';
import { islandIgnoreNames, readUnusedSettings } from '../../../src/util/unusedSettings';

/**
 * G43b — les ilots ne connaissaient ni les chemins exclus ni les noms exclus
 * des autres familles.
 *
 * Vu par la refutation de G43, commun a Find et a Remove. Avec les DEFAUTS, un
 * plugin et son aide sous `buildSrc/` partaient comme ilot alors que
 * `unusedSymbolsIgnorePaths` les exclut des symboles. Et un membre exclu par
 * `unusedMembersIgnoreNames` partait quand meme, avec la classe qui le
 * portait, parce que seul `deadIslandsIgnoreNames` comptait.
 */

const SEGS = ['/src/test/'];
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const MAIN = { path: '/w/app/src/main/java/q/Main.kt', text: 'package q\n\nfun main() {\n    println(1)\n}\n' };
const ile = (dir: string) => [
  { path: `${dir}/Ping.kt`, text: 'package p\n\nclass Ping {\n    fun go() = Pong().go()\n}\n' },
  { path: `${dir}/Pong.kt`, text: 'package p\n\nclass Pong {\n    fun go(): Int = Ping().hashCode()\n}\n' },
];
const noms = (sources: { path: string; text: string }[], extra: any = {}) =>
  findDeadIslands({ sources: [GRADLE, MAIN, ...sources], testSourceSets: SEGS, ...extra } as any).flatMap(i => i.names);
const coupe = (sources: { path: string; text: string }[], reglages: any) => {
  const tout = [GRADLE, MAIN, ...sources];
  const r = collecterUnePasse(tout, SEGS, { reglages });
  return [...r.parFichier.entries()].flatMap(([p, cs]) => cs.map(c => (tout.find(s => s.path === p)?.text ?? '').slice(c.start, c.end))).join('\n');
};

describe('G43b, temoins', () => {
  it('un ilot hors de tout chemin exclu est rapporte', () => {
    expect(noms(ile('/w/app/src/main/java/p'))).toEqual(expect.arrayContaining(['Ping', 'Pong']));
  });

  it('sans reglage, Remove coupe l ilot de buildSrc', () => {
    expect(coupe(ile('/w/buildSrc/src/main/kotlin/p'), {})).toContain('class Ping');
  });
});

describe('G43b, les ilots respectent les exclusions', () => {
  it('un ilot sous un chemin exclu n est pas rapporte', () => {
    expect(noms(ile('/w/buildSrc/src/main/kotlin/p'), { ignorePaths: ['**/buildSrc/**'] })).toEqual([]);
  });

  it('avec les defauts, Remove ne coupe pas l ilot de buildSrc', () => {
    const defauts = readUnusedSettings((_k, d) => d);
    expect(coupe(ile('/w/buildSrc/src/main/kotlin/p'), defauts)).not.toContain('class Ping');
  });

  it('un nom exclu des membres protege son ilot', () => {
    expect(coupe(ile('/w/app/src/main/java/p'), { membersIgnoreNames: ['Pong.go'] })).not.toContain('class Ping');
  });

  it('un nom exclu des symboles protege son ilot', () => {
    expect(coupe(ile('/w/app/src/main/java/p'), { symbolsIgnoreNames: ['Pong'] })).not.toContain('class Ping');
  });

  it('islandIgnoreNames reunit les trois listes', () => {
    expect([...islandIgnoreNames({ islandsIgnoreNames: ['A'], symbolsIgnoreNames: ['B'], membersIgnoreNames: ['C'] } as any)].sort())
      .toEqual(['A', 'B', 'C']);
  });
});

// ── Find : la commande des ilots et Find Everything Unused ─────────────────

import { vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { islandSettings } from '../../../src/commands/FindDeadIslands';
import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';

describe('G43b, Find juge avec les memes exclusions', () => {
  afterEach(() => vi.restoreAllMocks());
  const configure = (reglages: Record<string, unknown>) =>
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => (k in reglages ? reglages[k] : d) } as any);

  it('islandSettings reunit les noms et prend les chemins des symboles', () => {
    configure({ deadIslandsIgnoreNames: ['A'], unusedSymbolsIgnoreNames: ['B'], unusedMembersIgnoreNames: ['C'] });
    const s = islandSettings() as any;
    expect([...s.ignoreNames].sort()).toEqual(['A', 'B', 'C']);
    expect(s.ignorePaths).toEqual(['**/buildSrc/**', '**/build-logic/**']);
  });

  async function resume(sources: { path: string; text: string }[]) {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const avant = { info: win.showInformationMessage, warn: win.showWarningMessage, prog: win.withProgress };
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    configure({});
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    const messages: string[] = [];
    win.showInformationMessage = async (m: string) => { messages.push(m); return undefined; };
    win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
    const corpus: any = {
      invalidate: () => {},
      get: async () => ({ sources: [GRADLE, MAIN, ...sources], moduleDirs: [], modulesWithCode: [], libraryModules: [], index: { entries: () => [] }, truncated: false, sourcesTruncated: false }),
    };
    const stub: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };
    try {
      await findEverythingUnusedCommand(corpus, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, async () => undefined);
    } finally {
      Object.assign(win, { showInformationMessage: avant.info, showWarningMessage: avant.warn, withProgress: avant.prog });
    }
    return messages.join(' | ');
  }

  it('temoin : hors de buildSrc, le resume compte l ilot', async () => {
    expect(await resume(ile('/w/app/src/main/java/p'))).toMatch(/dead island/);
  });

  it('avec les defauts, le resume ne compte pas l ilot de buildSrc', async () => {
    expect(await resume(ile('/w/buildSrc/src/main/kotlin/p'))).not.toMatch(/dead island/);
  });
});

// ── Remove Test Only Code : ses ilots prennent les chemins de ses membres ───

import { scanTestOnly } from '../../../src/commands/RemoveTestOnlyCode';

describe('G43b, Remove Test Only Code', () => {
  afterEach(() => vi.restoreAllMocks());
  /** Un ilot que seul un test nomme, sous `racine`. */
  const groupes = async (racine: string) => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    const sources = [
      ...ile(`${racine}/src/main/kotlin/p`),
      { path: `${racine}/src/test/kotlin/p/PingTest.kt`, text: 'package p\n\nclass PingTest {\n    @Test\n    fun go() { check(Ping().go() == 1) }\n}\n' },
      MAIN,
    ];
    const corpus: any = { get: async () => ({ sources, moduleDirs: [], modulesWithCode: [], libraryModules: [], truncated: false, sourcesTruncated: false }) };
    const scan = await scanTestOnly(corpus, undefined, true);
    return (scan?.groups ?? []).flatMap(g => g.group.names);
  };

  it('temoin : hors de buildSrc, l ilot est propose', async () => {
    expect(await groupes('/w/app')).toContain('Ping');
  });

  it('avec les defauts, l ilot de buildSrc ne l est pas', async () => {
    expect(await groupes('/w/buildSrc')).not.toContain('Ping');
  });
});
