import { describe, it, expect } from 'vitest';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinSelectionRangeProvider } from '../../src/providers/SelectionRangeProvider';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { forgetLiveSymbols } from '../../src/util/liveSymbols';
import { isTestPath } from '../../src/util/testPaths';
import { LogcatService } from '../../src/logcat/LogcatService';

// Audit 36 : trouvé en passant l'extension sur un vrai projet Android,
// 3187 fichiers Kotlin et 1901 Java (LaPresse).

/** Document fidèle : lineAt lève hors bornes, comme le vrai TextDocument. */
function doc(uri: string, text: string, opts: { dirty?: boolean; version?: number } = {}): any {
  const lines = text.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: 'kotlin',
    version: opts.version ?? 1,
    isDirty: opts.dirty ?? false,
    getText: () => text,
    lineAt: (n: number) => {
      const t = lines[n];
      if (t === undefined) throw new RangeError(`Illegal value for line: ${n} (lineCount=${lines.length})`);
      return { text: t, range: { start: new Position(n, 0), end: new Position(n, t.length) } };
    },
    lineCount: lines.length,
  };
}

describe('Expand Selection sur une ligne d\'annotation', () => {
  // Forme exacte de core/network/.../ButtonContentDO.kt : un data class dont
  // chaque paramètre porte son @SerializedName sur la ligne du dessus. Le
  // balayage du vrai projet a trouvé 24 fichiers dans ce cas.
  const URI = 'file:///lp/ButtonContentDO.kt';
  const CODE = [
    'package nuglif.starship.core.network.dataobject',
    '',
    'import kotlinx.parcelize.Parcelize',
    '',
    '@Parcelize',
    'data class ButtonContentDO(',
    '    @SerializedName("text")',
    '    val text: TextDO? = null,',
    '    @SerializedName("action")',
    '    val action: ActionTargetDO? = null,',
    '    @SerializedName("styles")',
    '    val styles: StyleDO? = null,',
    ') : Parcelable',
  ].join('\n');

  function chainAt(line: number, character: number): Array<[number, number]> {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE));
    const provider = new KotlinSelectionRangeProvider(index);
    const d = doc(URI, CODE);
    const [range] = provider.provideSelectionRanges(d, [new Position(line, character)], {} as any);
    const out: Array<[number, number]> = [];
    for (let cur: any = range; cur; cur = cur.parent) out.push([cur.range.start.line, cur.range.end.line]);
    return out;
  }

  it('la plage rendue contient toujours le curseur', () => {
    // Curseur sur `@SerializedName("action")`, ligne 8. Avant : la chaîne
    // commençait par 7..7, c'est à dire la propriété PRÉCÉDENTE. Étendre la
    // sélection surlignait la ligne du dessus.
    for (const line of [6, 7, 8, 9, 10, 11]) {
      for (const [start, end] of chainAt(line, 4)) {
        expect(start, `ligne ${line}, plage ${start}..${end}`).toBeLessThanOrEqual(line);
        expect(end, `ligne ${line}, plage ${start}..${end}`).toBeGreaterThanOrEqual(line);
      }
    }
  });

  it('la chaîne reste emboîtée du plus large au plus étroit', () => {
    const chain = chainAt(9, 8);
    expect(chain.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < chain.length; i++) {
      const [s, e] = chain[i];
      const [ps, pe] = chain[i + 1];
      expect(ps).toBeLessThanOrEqual(s);
      expect(pe).toBeGreaterThanOrEqual(e);
    }
  });
});

describe('Fichier fermé sans enregistrer puis rouvert', () => {
  const URI = 'file:///lp/Repo.kt';
  // Session 1 : le tampon est long. VS Code détruit le document à la
  // fermeture, et la réouverture repart de la version 1.
  const LONG = [
    'package nuglif.starship.core.network',
    '',
    'class Repo(private val api: Api) {',
    '    fun load(id: String): Item? = api.get(id)',
    '    fun loadAll(): List<Item> = api.all()',
    '    fun refresh() { cache.clear() }',
    '    fun cached(): Item? = cache.first()',
    '}',
    '',
    'data class Item(val id: String)',
  ].join('\n');
  const SHORT = [
    'package nuglif.starship.core.network',
    '',
    'class Repo(private val api: Api) {',
    '    fun load(id: String): Item? = api.get(id)',
    '}',
  ].join('\n');

  it('l\'outline ne rejoue pas la structure de la session précédente', () => {
    forgetLiveSymbols();
    const index = new SymbolIndex();
    index.add(parse(URI, SHORT));
    const provider = new KotlinDocumentSymbolProvider(index);

    const first = provider.provideDocumentSymbols(doc(URI, LONG, { dirty: true, version: 2 }), {} as any);
    expect(first.map(s => s.name)).toEqual(['Repo', 'Item']);

    // Même URI, même version, contenu différent : ni la version ni l'URI ne
    // distinguent les deux sessions. Avant : lineAt levait « Illegal value for
    // line » et l'outline se vidait complètement.
    const second = provider.provideDocumentSymbols(doc(URI, SHORT, { dirty: true, version: 2 }), {} as any);
    expect(second.map(s => s.name)).toEqual(['Repo']);
    expect(second[0].children.map(c => c.name)).toEqual(['api', 'load']);
  });

  it('le pliage ne rejoue pas les replis de la session précédente', () => {
    forgetLiveSymbols();
    const index = new SymbolIndex();
    index.add(parse(URI, SHORT));
    const provider = new KotlinFoldingRangeProvider(index);
    const long = provider.provideFoldingRanges(doc(URI, LONG, { dirty: true, version: 2 }), {} as any, {} as any);
    expect(long.some(r => r.end >= 7)).toBe(true);
    const short = provider.provideFoldingRanges(doc(URI, SHORT, { dirty: true, version: 2 }), {} as any, {} as any);
    // Aucun repli ne peut dépasser la dernière ligne du tampon affiché.
    for (const r of short) expect(r.end).toBeLessThanOrEqual(4);
  });

  it('la même version et la même longueur restent partagées', () => {
    forgetLiveSymbols();
    const index = new SymbolIndex();
    index.add(parse(URI, SHORT));
    const d = doc(URI, LONG, { dirty: true, version: 3 });
    const provider = new KotlinDocumentSymbolProvider(index);
    provider.provideDocumentSymbols(d, {} as any);
    // Le partage entre fonctionnalités, la raison d'être de la mémo, tient
    // toujours : deux appels sur le MÊME document n'analysent qu'une fois.
    const again = provider.provideDocumentSymbols(d, {} as any);
    expect(again.map(s => s.name)).toEqual(['Repo', 'Item']);
  });
});

// ── Régressions de nos correctifs v1.42.42, trouvées par la chasse ──────────

describe('Source sets de test, portée de la règle de variante', () => {
  const SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
  const isTest = (p: string) => isTestPath(p, SETS);

  it('les variantes réelles du projet LaPresse sont reconnues', () => {
    // Formes relevées dans le dépôt : Gradle suffixe le nom de base, et pour
    // un source set de test unitaire le répertoire de langage compte aussi.
    expect(isTest('/lp/replica/app/src/testReplica/java/ca/lapresse/FooTest.java')).toBe(true);
    expect(isTest('/lp/replica/app/src/testAdPreflightLaPresseRelease/java/A.java')).toBe(true);
    expect(isTest('/lp/app/src/androidTestDebug/kotlin/FooTest.kt')).toBe(true);
    expect(isTest('/lp/lib/src/jvmTestFixtures/kotlin/Fake.kt')).toBe(true);
    expect(isTest('/lp/app/src/test/kotlin/FooTest.kt')).toBe(true);
  });

  it('la règle est ancrée sur le source set, pas sur un composant quelconque', () => {
    // La première version scannait TOUS les composants du chemin, y compris le
    // nom de fichier. Un fichier de production nommé androidTestHelper.kt
    // passait pour du test et disparaissait de Go to Definition.
    expect(isTest('/proj/app/src/main/kotlin/com/acme/androidTestHelper.kt')).toBe(false);
    expect(isTest('/proj/androidTestUtils/src/main/kotlin/Helper.kt')).toBe(false);
    expect(isTest('/proj/app/src/main/kotlin/jvmTestSupportModel.kt')).toBe(false);
    expect(isTest('/Users/kevin/testFlight/app/src/main/kotlin/Prod.kt')).toBe(false);
  });

  it('le répertoire de langage est exigé quand le réglage le nomme', () => {
    // `test/java` nomme une paire : src/testDebug/res n'est pas du code de test.
    expect(isTest('/proj/app/src/testDebug/java/FooTest.java')).toBe(true);
    expect(isTest('/proj/app/src/testDebug/res/values/strings.xml')).toBe(false);
  });
});

describe('Plafond des PID suivis', () => {
  function svc(pkg: string) {
    const s: any = new LogcatService({ lookupFqn: () => undefined } as any, {
      channel: { appendLine: () => {} }, debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    } as any);
    s.filter.followedPackage = pkg;
    s.filter.followAppPid = true;
    return s;
  }

  it('le processus principal survit à l\'éviction', () => {
    const s = svc('com.example.app');
    s.noteProcessStart(4600, 'com.example.app', false);
    for (let i = 0; i < 40; i++) s.noteProcessStart(7000 + i, 'com.example.app', true);
    const pids: Set<number> = s.filter.followedPids;
    // Le principal est inséré en premier : une éviction FIFO nue le jetait la
    // première, et les lignes du processus que l'utilisateur regarde
    // disparaissaient du panneau pendant que le bruit restait.
    expect(pids.has(4600)).toBe(true);
    expect(s.filter.followedPid).toBe(4600);
    expect(pids.size).toBeLessThanOrEqual(16);
    expect(pids.has(7039)).toBe(true);
    s.dispose();
  });
});

describe('Reconnexion au même appareil Logcat', () => {
  it('l\'ancre de reprise est conservée', () => {
    const s: any = new LogcatService({ lookupFqn: () => undefined } as any, {
      channel: { appendLine: () => {} }, debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    } as any);
    s.currentSerial = 'PIXEL7';
    s.onEntry({ ts: Date.UTC(2026, 3, 29, 22, 0, 0), pid: 1, tid: 1, level: 'I', tag: 'T', message: 'm', seq: 1 });
    const anchor = s.resumeSince();
    expect(anchor).toBeTruthy();
    // Même appareil, flux tombé puis relancé : sans l'ancre, adb rejoue tout le
    // tampon de l'appareil et chaque ligne déjà lue revient.
    s.switchDevice('PIXEL7');
    expect(s.resumeSince()).toBe(anchor);
    // Un autre appareil, en revanche, a sa propre horloge.
    s.switchDevice('emulator-5554');
    expect(s.resumeSince()).toBeUndefined();
    s.dispose();
  });
});

describe('Positions des écritures d\'état', () => {
  it('le compte et la liste des sites voient les mêmes écritures', async () => {
    const { analyzeStateProvenance, collectWriteSites } =
      await import('../../src/providers/StateProvenanceProvider');
    const vm = [
      'class VM {',
      '    private val _a = MutableStateFlow(0)',
      '    private val _b = MutableSharedFlow<Int>()',
      '    fun go(v: Int) { _a.value=_b.emit(v) }',
      '}',
    ].join('\n');
    // Les deux chemins partageaient la même intention mais pas la même regex :
    // collectWriteSites avait gardé la classe qui avale un caractère.
    expect(analyzeStateProvenance(vm).find(s => s.property === '_b')?.directWrites).toBe(1);
    expect(collectWriteSites('_b', vm).length).toBe(1);
    expect(collectWriteSites('_a', vm).length).toBe(1);

    // La vraie divergence : une ecriture en toute fin de fichier. La classe
    // negative exige un caractere apres le =, le lookahead non. Le compteur
    // annoncait 1 write et le peek ne proposait aucune position.
    const tail = 'class VM {\n    private val _a = MutableStateFlow(0)\n    fun go(v: Int) { _a.value =';
    expect(analyzeStateProvenance(tail)[0].directWrites).toBe(1);
    expect(collectWriteSites('_a', tail).length).toBe(1);
  });
});
