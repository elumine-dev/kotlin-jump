import { describe, it, expect, vi } from 'vitest';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { symbolsForDocument, forgetLiveSymbols } from '../../src/util/liveSymbols';

// Le double du module adb, pose au niveau du fichier : aucun test d'ici ne
// peut lancer un processus, quel que soit le chemin de code emprunte. Poser un
// bouchon sur la methode privee `startStream` marchait aussi, mais liait le
// test au NOM de cette methode : la renommer relançait adb en silence.
vi.mock('../../src/android/AdbBinary', () => ({
  spawnAdb: () => { throw new Error('spawnAdb interdit dans la suite unitaire'); },
  runAdb: () => Promise.resolve(undefined),
  runShell: () => Promise.resolve(undefined),
  resolveAdbPath: () => '/fake/adb',
  invalidateAdbPathCache: () => {},
  watchAdbPathSetting: () => ({ dispose: () => {} }),
  parseDevicesOutput: () => [],
}));

// Audit 35 : coût du chemin « tampon non sauvegardé ».

const URI = 'file:///a35/Live.kt';
const CODE = [
  'package p',
  '',
  'class A {',
  '    fun one() {',
  '        val x = 1',
  '    }',
  '}',
].join('\n');

function doc(opts: { dirty: boolean; version: number; uri?: string; text?: string }): any {
  const text = opts.text ?? CODE;
  const lines = text.split('\n');
  const uri = opts.uri ?? URI;
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: 'kotlin',
    version: opts.version,
    isDirty: opts.dirty,
    getText: () => text,
    lineAt: (n: number) => {
      const t = lines[n] ?? '';
      return { text: t, range: { start: new Position(n, 0), end: new Position(n, t.length) } };
    },
    lineCount: lines.length,
  };
}

function cleanIndex() {
  const index = new SymbolIndex();
  index.add(parse(URI, CODE));
  return index;
}

describe('Analyse du tampon vivant', () => {
  it('le fichier n\'est analysé qu\'une fois par version, quel que soit le nombre de features', () => {
    forgetLiveSymbols();
    const index = cleanIndex();
    const d = doc({ dirty: true, version: 7 });
    // Le fil d'Ariane, le pliage et Expand Selection demandent le même
    // document à la même version, l'un après l'autre. Mesuré sur 5164 lignes :
    // 8,96 ms sans partage contre 6,26 ms avec.
    const first = symbolsForDocument(index, d);
    const second = symbolsForDocument(index, d);
    expect(second).toBe(first);
  });

  it('une frappe invalide le partage', () => {
    forgetLiveSymbols();
    const index = cleanIndex();
    const a = symbolsForDocument(index, doc({ dirty: true, version: 1 }));
    const b = symbolsForDocument(index, doc({ dirty: true, version: 2 }));
    expect(b).not.toBe(a);
  });

  it('un autre document n\'hérite pas des symboles du précédent', () => {
    forgetLiveSymbols();
    const index = cleanIndex();
    const other = 'file:///a35/Other.kt';
    symbolsForDocument(index, doc({ dirty: true, version: 3 }));
    const got = symbolsForDocument(index, doc({
      dirty: true, version: 3, uri: other, text: 'package p\n\nclass Elsewhere',
    }));
    expect(got.map(e => e.name)).toContain('Elsewhere');
    expect(got.map(e => e.name)).not.toContain('A');
  });

  it('après sauvegarde on repasse par l\'index, pas par le partage', () => {
    forgetLiveSymbols();
    const index = new SymbolIndex();
    index.add(parse(URI, 'package p\n\nclass FromDisk'));
    // Même version : seul isDirty distingue les deux branches, et sauvegarder
    // n'incrémente pas document.version.
    const dirty = symbolsForDocument(index, doc({ dirty: true, version: 9 }));
    expect(dirty.map(e => e.name)).toContain('A');
    const saved = symbolsForDocument(index, doc({ dirty: false, version: 9 }));
    expect(saved.map(e => e.name)).toEqual(['FromDisk']);
  });
});

// ── Régressions nées des correctifs v1.42.38 à v1.42.41 ─────────────────────

describe('Comptage des écritures d\'état', () => {
  it('deux écritures collées sont comptées toutes les deux', async () => {
    const { analyzeStateProvenance } = await import('../../src/providers/StateProvenanceProvider');
    const vm = [
      'class VM {',
      '    private val _a = MutableStateFlow(0)',
      '    private val _b = MutableSharedFlow<Int>()',
      // Sans espace après le `=` : la classe négative `[^=]` consommait le
      // caractère suivant, donc le `_` de `_b`, et l'écriture de _b disparaissait.
      '    fun go(v: Int) { _a.value=_b.emit(v) }',
      '}',
    ].join('\n');
    const all = analyzeStateProvenance(vm);
    expect(all.find(s => s.property === '_a')?.directWrites).toBe(1);
    expect(all.find(s => s.property === '_b')?.directWrites).toBe(1);
  });

  it('une comparaison n\'est toujours pas une écriture', async () => {
    const { analyzeStateProvenance } = await import('../../src/providers/StateProvenanceProvider');
    const vm = 'class VM {\n    private val _a = MutableStateFlow(0)\n    fun eq() = _a.value == 1\n}';
    expect(analyzeStateProvenance(vm)[0].directWrites).toBe(0);
  });

  it('une écriture en fin de fichier, sans rien derrière, est comptée', async () => {
    const { analyzeStateProvenance } = await import('../../src/providers/StateProvenanceProvider');
    const vm = 'class VM {\n    private val _a = MutableStateFlow(0)\n    fun go(v: Int) { _a.value =';
    expect(analyzeStateProvenance(vm)[0].directWrites).toBe(1);
  });
});

describe('Destination d\'une navigation, cas ordinaires', () => {
  it('la même route déclarée dans deux flavors reste une seule destination', async () => {
    const { resolveTargetRoute } = await import('../../src/indexer/NavigationIndex');
    // src/main et src/debug déclarent tous les deux `detail/{id}`. Compter
    // deux candidats identiques comme une ambiguïté effaçait la flèche, et la
    // légende tombait à zéro navigation sur tout projet à flavors.
    expect(resolveTargetRoute('detail/{id}', ['detail/{id}', 'detail/{id}'])).toBe('detail/{id}');
    expect(resolveTargetRoute('home', ['home', 'home', 'settings'])).toBe('home');
  });

  it('un écran paramétré gagne sur son voisin littéral de même préfixe', async () => {
    const { resolveTargetRoute } = await import('../../src/indexer/NavigationIndex');
    // `profile/{userId}` à côté de `profile/edit` est la forme la plus
    // courante d'un graphe Compose. Refuser de choisir supprimait toutes les
    // flèches vers l'écran paramétré.
    expect(resolveTargetRoute('profile/{id}', ['profile/{userId}', 'profile/edit'])).toBe('profile/{userId}');
    expect(resolveTargetRoute('orders/{x}', ['orders/new', 'orders/{orderId}'])).toBe('orders/{orderId}');
    // Une cible littérale désigne son homonyme exact, pas le paramétré.
    expect(resolveTargetRoute('profile/edit', ['profile/{userId}', 'profile/edit'])).toBe('profile/edit');
  });

  it('une vraie ambiguïté ne tranche toujours pas', async () => {
    const { resolveTargetRoute } = await import('../../src/indexer/NavigationIndex');
    expect(resolveTargetRoute('detail/{id}', ['detail/{a}', 'detail/{b}'])).toBeUndefined();
    expect(resolveTargetRoute('{dest}', ['home', 'settings'])).toBeUndefined();
    expect(resolveTargetRoute('absent', ['home'])).toBeUndefined();
  });

  it('la carte trace la flèche vers l\'écran paramétré', async () => {
    const { parseNavigation } = await import('../../src/indexer/NavigationIndex');
    const kt = [
      'fun graph(nc: NavHostController) {',
      '    composable("profile/edit") { Edit() }',
      '    composable("profile/{userId}") { Profile() }',
      '    composable("home") { Home(open = { id: String -> nc.navigate("profile/$id") }) }',
      '}',
    ].join('\n');
    expect(parseNavigation(kt, new Map()).edges).toEqual([{ from: 'home', to: 'profile/{userId}' }]);
  });
});

describe('Source sets de test de variante', () => {
  it('androidTestDebug et jvmTestFixtures sont des sources de test', async () => {
    const { isTestPath } = await import('../../src/util/testPaths');
    const SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
    // Gradle suffixe le nom de base en camel case pour chaque variante. Exiger
    // un composant exact les manquait tous, et Cmd+clic depuis un test
    // d'instrumentation ne renvoyait plus rien.
    expect(isTestPath('/p/app/src/androidTestDebug/kotlin/FooTest.kt', SETS)).toBe(true);
    expect(isTestPath('/p/lib/src/jvmTestFixtures/kotlin/Fake.kt', SETS)).toBe(true);
    expect(isTestPath('/p/lib/src/commonTestJvm/kotlin/Fake.kt', SETS)).toBe(true);
    expect(isTestPath('c:\\p\\app\\src\\androidTestDebug\\kotlin\\FooTest.kt', SETS)).toBe(true);
    expect(isTestPath('/p/app/src/androidTest/kotlin/FooTest.kt', SETS)).toBe(true);
  });

  it('le suffixe doit être en camel case, sinon ce n\'est pas un source set', async () => {
    const { isTestPath } = await import('../../src/util/testPaths');
    // Un utilisateur qui configure `test` tout court ne doit pas voir
    // `testdata` ou `testing` classés comme des sources de test.
    expect(isTestPath('/p/app/src/testdata/Fixtures.kt', ['test'])).toBe(false);
    expect(isTestPath('/p/app/src/testing/Helper.kt', ['test'])).toBe(false);
    expect(isTestPath('/p/app/src/testFixtures/Helper.kt', ['test'])).toBe(true);
    // Le faux positif d'origine reste corrigé.
    expect(isTestPath('/repos/test/kotlin-jump-demo/src/main/kotlin/A.kt', ['test/kotlin'])).toBe(false);
  });
});

describe('Changement d\'appareil Logcat', () => {
  it('l\'ancre de reprise ne suit pas sur le nouvel appareil', async () => {
    const { LogcatService } = await import('../../src/logcat/LogcatService');
    const noopLog: any = { channel: { appendLine: () => {} }, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const svc: any = new LogcatService({ lookupFqn: () => undefined } as any, noopLog);
    svc.onEntry({ ts: Date.UTC(2026, 3, 29, 22, 0, 0), pid: 1, tid: 1, level: 'I', tag: 'T', message: 'm', seq: 1 });
    expect(svc.resumeSince()).toBeTruthy();
    // L'horodatage vient de l'horloge de l'appareil précédent. Un émulateur en
    // UTC et un téléphone en heure locale sont à des heures d'écart : le
    // nouveau flux partait avec un -T venu du futur et n'affichait rien.
    svc.switchDevice('emulator-5554');
    expect(svc.resumeSince()).toBeUndefined();
    svc.dispose();
  });
});

describe('Cache du CodeLens de provenance', () => {
  it('un fichier modifié hors de l\'éditeur ne rejoue pas les anciens lens', async () => {
    const { StateProvenanceProvider } = await import('../../src/providers/StateProvenanceProvider');
    const provider = new StateProvenanceProvider();
    const uri = 'file:///a35/VM.kt';
    const doc = (text: string, version: number): any => ({
      uri: { toString: () => uri }, languageId: 'kotlin', version, getText: () => text,
    });
    const before = 'class VM {\n    private val _a = MutableStateFlow(0)\n    fun go() { _a.value = 1 }\n}';
    const after = [
      'class VM {',
      '    private val _a = MutableStateFlow(0)',
      '    fun go() { _a.value = 1 }',
      '    fun again() { _a.value = 2 }',
      '}',
    ].join('\n');
    expect(provider.provideCodeLenses(doc(before, 1))[0].command?.title).toContain('1 write');
    // Après un git checkout pendant que l'onglet était fermé, la réouverture
    // repart de la version 1. La version seule ne suffit donc pas comme
    // identité du contenu.
    expect(provider.provideCodeLenses(doc(after, 1))[0].command?.title).toContain('2 writes');
  });
});

describe('Index de travail réduit au strict nécessaire', () => {
  it('le mode fichier seul rend exactement les mêmes entrées', async () => {
    const { SymbolIndex } = await import('../../src/indexer/SymbolIndex');
    const { parse } = await import('../../src/indexer/KotlinParser');
    const uri = 'file:///a35/Shape.kt';
    const code = [
      'package com.app',
      '',
      'interface Shape',
      'class Circle : Shape {',
      '    companion object { const val SIDES = 0 }',
      '    fun area(): Double = 0.0',
      '}',
      'enum class Kind { A, B }',
    ].join('\n');

    const full = new SymbolIndex();
    full.add(parse(uri, code));
    const light = new SymbolIndex();
    light.add(parse(uri, code), undefined, true);

    // Les entrées par fichier, la seule chose que lit symbolsForDocument,
    // doivent être identiques champ pour champ.
    expect(JSON.stringify(light.getFileSymbols(uri))).toBe(JSON.stringify(full.getFileSymbols(uri)));
    // Ce qui est sauté, ce sont les tables de recherche que personne ne lit ici.
    expect(full.lookup('Circle').length).toBeGreaterThan(0);
    expect(light.lookup('Circle')).toEqual([]);
  });

  it('la structure d\'un tampon sale reste juste avec l\'index réduit', async () => {
    const { KotlinDocumentSymbolProvider } = await import('../../src/providers/DocumentSymbolProvider');
    const { SymbolIndex } = await import('../../src/indexer/SymbolIndex');
    const { parse } = await import('../../src/indexer/KotlinParser');
    forgetLiveSymbols();
    const uri = 'file:///a35/Doc.kt';
    const text = 'package p\n\nclass Outer {\n    fun inner() {\n        val x = 1\n    }\n}\n';
    const lines = text.split('\n');
    const index = new SymbolIndex();
    index.add(parse(uri, 'package p\n\nclass Stale'));
    const doc: any = {
      uri: { toString: () => uri, path: '/a35/Doc.kt' },
      languageId: 'kotlin',
      version: 4,
      isDirty: true,
      getText: () => text,
      lineAt: (n: number) => {
        const t = lines[n] ?? '';
        return { text: t, range: { start: new Position(n, 0), end: new Position(n, t.length) } };
      },
      lineCount: lines.length,
    };
    const symbols = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc, {} as any);
    expect(symbols.map(s => s.name)).toEqual(['Outer']);
    expect(symbols[0].children.map(c => c.name)).toEqual(['inner']);
  });
});
