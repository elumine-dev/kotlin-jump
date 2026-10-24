import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G43 — les exclusions de l utilisateur ne traversaient pas Remove All.
 *
 * Find Everything Unused lit ses reglages (`unusedSymbolsIgnoreNames`,
 * `unusedRemoteConfigKeysIgnoreNames`, ...) et ne rapporte pas ce qu ils
 * excluent. `collecterUnePasse` n en recevait aucun : ce que l utilisateur
 * avait explicitement exclu du rapport etait SUPPRIME par Remove Everything
 * Unused. Meme sans reglage, le defaut `unusedSymbolsIgnorePaths`
 * (`**\/buildSrc/**`, `**\/build-logic/**`) n etait pas applique.
 *
 * Le projet de reference ne configure aucune exclusion : la porte reste a zero
 * ecart, et ce temoin pose les reglages lui meme.
 *
 * `unusedSymbolsIncludeTestOnly` voyage aussi, sans cas ici : Remove All ne
 * coupe jamais un symbole que seuls des tests nomment, c est le travail de
 * Remove Test Only Code.
 */

const SEGS = ['/src/test/', '/src/androidTest/'];
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const MAIN = { path: '/w/app/src/main/java/q/Main.kt', text: 'package q\n\nfun main() {\n    println(Vivant().f())\n    println(E.A)\n    p.Bus().start()\n}\n' };

/** Tout ce que la passe couperait : texte des coupes et fichiers effaces. */
const coupe = (sources: { path: string; text: string }[], ctx: any = {}): string => {
  const r = collecterUnePasse([GRADLE, MAIN, ...sources], SEGS, ctx);
  const textes = [...r.parFichier.entries()].flatMap(([p, cs]) => {
    const t = [GRADLE, MAIN, ...sources].find(s => s.path === p)?.text ?? '';
    return cs.map(c => t.slice(c.start, c.end));
  });
  return [...textes, ...r.fichiersMorts].join('\n');
};

/** Le bus de KJ038 : un abonne entendu, et un post que personne n ecoute. */
const BUS = [
  { path: '/w/app/src/main/java/p/Bus.kt', text: 'package p\n\nclass Bus {\n    fun start() {\n        EventBus.getDefault().register(this)\n        EventBus.getDefault().post(HeardEvent())\n        EventBus.getDefault().post(GhostEvent())\n    }\n\n    @Subscribe\n    fun onBusEvent(event: HeardEvent) {\n        println(event)\n    }\n}\n' },
  { path: '/w/app/src/main/java/p/HeardEvent.kt', text: 'package p\n\nclass HeardEvent\n' },
  { path: '/w/app/src/main/java/p/GhostEvent.kt', text: 'package p\n\nclass GhostEvent\n' },
];

const CAS: { famille: string; sources: { path: string; text: string }[]; reglages: any; marque: string; ctx?: any }[] = [
  {
    famille: 'symboles, par nom',
    sources: [{ path: '/w/app/src/main/java/p/Morte.kt', text: 'package p\n\nclass Morte {\n    fun g() = 1\n}\n' }],
    reglages: { symbolsIgnoreNames: ['Mor*'] },
    marque: 'Morte',
  },
  {
    famille: 'symboles, par chemin',
    sources: [{ path: '/w/buildSrc/src/main/kotlin/p/Outil.kt', text: 'package p\n\nclass Outil {\n    fun g() = 1\n}\n' }],
    reglages: { symbolsIgnorePaths: ['**/buildSrc/**'] },
    marque: 'Outil',
  },
  {
    famille: 'membres',
    sources: [{ path: '/w/app/src/main/java/q/Vivant.kt', text: 'package q\n\nclass Vivant {\n    fun f() = 1\n    fun morte() = 2\n}\n' }],
    reglages: { membersIgnoreNames: ['morte'] },
    marque: 'fun morte',
  },
  {
    famille: 'entrees d enum',
    sources: [{ path: '/w/app/src/main/java/q/E.kt', text: 'package q\n\nenum class E {\n    A,\n    MORTE,\n}\n' }],
    reglages: { enumEntriesIgnoreNames: ['E.MORTE'] },
    marque: 'MORTE',
  },
  {
    famille: 'cles Remote Config',
    sources: [{ path: '/w/app/src/main/res/xml/remote_config_defaults.xml', text: '<defaults>\n    <entry><key>cle_morte</key><value>1</value></entry>\n</defaults>\n' }],
    reglages: { remoteConfigIgnoreNames: ['cle_*'] },
    marque: 'cle_morte',
  },
  {
    famille: 'alias Gradle',
    sources: [{ path: '/w/gradle/libs.versions.toml', text: '[libraries]\nlib-morte = { module = "a:b", version = "1" }\n' }],
    reglages: { gradleIgnoreNames: ['lib-morte'] },
    marque: 'lib-morte',
  },
  {
    famille: 'cles de ressources',
    sources: [{ path: '/w/app/src/main/res/values/strings.xml', text: '<resources>\n    <string name="debug_morte">x</string>\n</resources>\n' }],
    reglages: { resourceKeysIgnorePrefixes: ['debug_'] },
    marque: 'debug_morte',
    ctx: { modulesWithCode: ['/w/app'] },
  },
  {
    famille: 'symboles, par suffixe de cadre',
    sources: [{ path: '/w/app/src/main/java/p/OldWorker.kt', text: 'package p\n\nclass OldWorker {\n    fun g() = 1\n}\n' }],
    reglages: { frameworkNameSuffixes: true },
    marque: 'OldWorker',
  },
  {
    famille: 'evenements, par nom',
    sources: [
      ...BUS,
    ],
    reglages: { eventsIgnoreNames: ['GhostEvent'] },
    marque: 'post(GhostEvent())',
  },
  {
    famille: 'evenements, abonnement suppose',
    sources: [
      ...BUS,
    ],
    reglages: { eventsAssumeSubscribed: ['GhostEvent'] },
    marque: 'post(GhostEvent())',
  },
  {
    famille: 'ilots, par nom',
    sources: [
      { path: '/w/app/src/main/java/p/Ping.kt', text: 'package p\n\nclass Ping {\n    fun go() = Pong().go()\n}\n' },
      { path: '/w/app/src/main/java/p/Pong.kt', text: 'package p\n\nclass Pong {\n    fun go(): Int = Ping().hashCode()\n}\n' },
    ],
    reglages: { islandsIgnoreNames: ['Ping'] },
    marque: 'class Ping',
  },
  {
    famille: 'ilots, par taille',
    sources: [
      { path: '/w/app/src/main/java/p/Ping.kt', text: 'package p\n\nclass Ping {\n    fun go() = Pong().go()\n}\n' },
      { path: '/w/app/src/main/java/p/Pong.kt', text: 'package p\n\nclass Pong {\n    fun go(): Int = Ping().hashCode()\n}\n' },
    ],
    reglages: { islandsMaxSize: 1 },
    marque: 'class Ping',
  },
];

describe('G43, temoins : sans reglage, chaque famille coupe', () => {
  it.each(CAS)('$famille', ({ sources, marque, ctx }) => {
    expect(coupe(sources, ctx)).toContain(marque);
  });
});

describe('G43, les exclusions traversent Remove All', () => {
  it.each(CAS)('$famille', ({ sources, reglages, marque, ctx }) => {
    expect(coupe(sources, { ...ctx, reglages })).not.toContain(marque);
  });
});

// ── Le gardien : une seule liste, tenue contre ses deux sources ────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { UNUSED_SETTING_KEYS, readUnusedSettings } from '../../../src/util/unusedSettings';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';

const RACINE = path.resolve(__dirname, '../../..');

describe('G43, la liste des reglages ne derive pas', () => {
  it('chaque reglage que Find lit pour une famille est lu par Remove', () => {
    const find = fs.readFileSync(path.join(RACINE, 'src/commands/FindEverythingUnused.ts'), 'utf8');
    const lues = [...find.matchAll(/cfg\.get<[^>]+>\('([\w.]+)'/g)].map(m => m[1]);
    // Hors familles : le balayage a sa propre commande, les source sets sont
    // deja lus par Remove, et Remove ecarte selfOnly expres (les ilots le portent).
    const horsFamille = new Set(['deadCodeSweep', 'testSourceSets', 'unusedMembersSelfOnly']);
    expect(lues.length).toBeGreaterThan(10);
    expect(lues.filter(k => !horsFamille.has(k) && !UNUSED_SETTING_KEYS.includes(k))).toEqual([]);
  });

  it('chaque defaut est celui que package.json declare', () => {
    const props = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).contributes.configuration;
    const toutes = Object.assign({}, ...(Array.isArray(props) ? props : [props]).map((c: any) => c.properties));
    const lus = readUnusedSettings((_k, fallback) => fallback) as any;
    const parCle = Object.fromEntries(UNUSED_SETTING_KEYS.map((k, i) => [k, Object.values(lus)[i]]));
    for (const k of UNUSED_SETTING_KEYS) {
      expect(toutes[`kotlinJump.${k}`], `kotlinJump.${k} absent de package.json`).toBeDefined();
      expect(parCle[k], k).toEqual(toutes[`kotlinJump.${k}`].default);
    }
  });
});

describe('G43, la commande lit les reglages', () => {
  afterEach(() => vi.restoreAllMocks());

  async function retire(reglages: Record<string, unknown>, cacheStable = false) {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const avant = { info: win.showInformationMessage, warn: win.showWarningMessage, prog: win.withProgress, apply: w.applyEdit };
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => (k in reglages ? reglages[k] : d) } as any);
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    win.showInformationMessage = async (_m: string, ...rest: any[]) => (rest[0]?.modal ? 'Apply all' : undefined);
    win.showWarningMessage = async () => undefined;
    const touches: string[] = [];
    w.applyEdit = async (e: any) => {
      for (const x of e._entries) touches.push(x.uri.fsPath ?? String(x.uri));
      for (const x of e._fileDeletes) touches.push(x.uri.fsPath ?? String(x.uri));
      return true;
    };
    // `Autre` n est exclue de rien : la premiere passe a toujours de quoi
    // couper, et la commande entre dans ses rondes.
    const sources = [GRADLE, MAIN,
      { path: '/w/app/src/main/java/p/Morte.kt', text: 'package p\n\nclass Morte\n' },
      { path: '/w/app/src/main/java/p/Autre.kt', text: 'package p\n\nclass Autre\n' }];
    const lire = () => ({ sources, moduleDirs: [], modulesWithCode: [], libraryModules: [], index: { entries: () => [] }, truncated: false, sourcesTruncated: false });
    // Cache stable : la ronde 0 reprend le resultat de la premiere passe.
    // Sinon elle recalcule avec le contexte de la boucle.
    const fige = lire();
    const corpus: any = { invalidate: () => {}, get: async () => (cacheStable ? fige : lire()) };
    try {
      await removeEverythingUnusedCommand(corpus, async () => undefined);
    } finally {
      Object.assign(win, { showInformationMessage: avant.info, showWarningMessage: avant.warn, withProgress: avant.prog });
      w.applyEdit = avant.apply;
    }
    return touches;
  }

  it.each([false, true])('temoin : sans reglage, Morte.kt est touche (cache stable : %s)', async (stable) => {
    expect(await retire({}, stable)).toContain('/w/app/src/main/java/p/Morte.kt');
  });

  it.each([false, true])('avec unusedSymbolsIgnoreNames, Morte.kt reste intact (cache stable : %s)', async (stable) => {
    const touches = await retire({ unusedSymbolsIgnoreNames: ['Morte'] }, stable);
    expect(touches).toContain('/w/app/src/main/java/p/Autre.kt');
    expect(touches).not.toContain('/w/app/src/main/java/p/Morte.kt');
  });
});
