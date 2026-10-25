import { describe, it, expect } from 'vitest';
import { collecterUnePasse, compteLesFamilles, sansChevauchement } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Campagne de nettoyage, T1 : chaque coupe porte sa preuve.
 *
 * `Coupe` ne gardait que `{start, end, texte, famille, quoi}`. Le verdict du
 * detecteur, ses mentions de test, le canal par lequel il a raisonne et la
 * declaration qu'une coupe de cascade suivait etaient jetes a l'entree de
 * `ajoute`. Une fiche de preuve par coupe n'etait donc pas possible : c'est
 * G55, planifie depuis longtemps et jamais construit.
 *
 * Fixtures neutres : `com.x`, `p`, `q`.
 */

const SEGS = ['/src/test/', '/src/androidTest/'];
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const JAVA = '/w/app/src/main/java/com/x';
const KT = '/w/app/src/main/kotlin/com/x';

// Une classe que seules deux declarations d injection nomment (KJ-067).
const DELEGATE = f(`${JAVA}/TraceRouteDelegate.java`, [
  'package com.x;', '', 'import javax.inject.Inject;', '',
  'public class TraceRouteDelegate {', '', '    @Inject ConnectivityService connectivityService;', '',
  '    @Inject', '    public TraceRouteDelegate() {', '    }', '}', '',
].join('\n'));
const COMPOSANT = f(`${KT}/AppComponent.kt`, [
  'package com.x', '', 'import com.x.TraceRouteDelegate', '',
  '@Component', 'interface AppComponent {', '    fun inject(target: TraceRouteDelegate)', '}', '',
].join('\n'));
const VIDE = f(`${KT}/EmptyAppComponent.kt`, [
  'package com.x', '', 'import com.x.TraceRouteDelegate', '',
  'object EmptyAppComponent : AppComponent {', '    override fun inject(target: TraceRouteDelegate) {}', '}', '',
].join('\n'));
const SERVICE = f(`${JAVA}/ConnectivityService.java`,
  'package com.x;\n\npublic interface ConnectivityService {\n    boolean isConnected();\n}\n');
const APP = f(`${KT}/App.kt`, [
  'package com.x', '', 'class App {', '    val component: AppComponent = EmptyAppComponent', '}', '',
  'fun main() {', '    App().component', '}', '',
].join('\n'));

// Un ilot de deux classes qui ne se nomment que l une l autre.
const MAIN = f('/w/app/src/main/java/q/Main.kt', 'package q\n\nfun main() {\n    println(1)\n}\n');
const PING = f('/w/app/src/main/java/p/Ping.kt', 'package p\n\nclass Ping {\n    fun go() = Pong().go()\n}\n');
const PONG = f('/w/app/src/main/java/p/Pong.kt', 'package p\n\nclass Pong {\n    fun go(): Int = Ping().hashCode()\n}\n');

const coupes = (sources: { path: string; text: string }[]) => {
  const { parFichier } = collecterUnePasse(sources, SEGS);
  return [...parFichier.entries()].flatMap(([path, l]) => l.map(c => ({ path, ...c })));
};

describe('T1, temoins : une coupe sans preuve traverse la passe inchangee', () => {
  const nue = { start: 0, end: 1, texte: '', famille: 'symboles', quoi: 'x' };

  it('sansChevauchement rend la coupe telle quelle', () => {
    const [[, [c]]] = [...sansChevauchement(new Map([['/a.kt', [nue]]]))];
    expect(c).toEqual(nue);
    expect('preuve' in c).toBe(false);
  });

  it('compteLesFamilles la compte sans la lire', () => {
    expect(compteLesFamilles(new Map([['/a.kt', [nue]]])).symboles).toBe(1);
  });
});

describe('T1, la preuve d une coupe de symbole', () => {
  const tout = [DELEGATE, COMPOSANT, VIDE, SERVICE, APP, GRADLE];
  const delegate = () => coupes(tout).find(c => c.famille === 'symboles' && c.quoi === 'TraceRouteDelegate')!;

  it('porte le verdict et le canal du detecteur', () => {
    const c = delegate() as any;
    expect(c).toBeDefined();
    expect(c.preuve).toBeDefined();
    expect(c.preuve.verdict).toBe('unreferenced');
    expect(c.preuve.via).toBe('injection');
    expect(c.preuve.mentions).toEqual({ tests: 0 });
  });

  it('nomme les fichiers que la coupe emporte, pour que le relecteur les retrouve', () => {
    const c = delegate() as any;
    expect([...new Set((c.preuve.emporte as { path: string }[]).map(e => e.path))].sort())
      .toEqual([COMPOSANT.path, VIDE.path].sort());
  });

  it('une declaration d injection et un import perime disent quelle declaration ils suivent', () => {
    const suiveurs = coupes(tout).filter(c => c.path === COMPOSANT.path) as any[];
    expect(suiveurs.length).toBeGreaterThanOrEqual(2);
    for (const s of suiveurs) {
      expect(s.preuve.verdict).toBe('cascade');
      expect(s.preuve.suit).toBe('TraceRouteDelegate');
    }
  });

  it('un import perime porte l instruction entiere comme nom : deux imports longs ne partagent jamais une cle', () => {
    const imp = coupes(tout).find(c => c.path === COMPOSANT.path && c.famille === 'balayage') as any;
    expect(imp.preuve.nom).toBe('import com.x.TraceRouteDelegate');
  });
});

describe('T1, la preuve d un ilot', () => {
  it('dit par qui chaque membre etait tenu en vie', () => {
    const ile = coupes([GRADLE, MAIN, PING, PONG]).filter(c => c.famille === 'ilots') as any[];
    const ping = ile.find(c => c.quoi === 'Ping');
    const pong = ile.find(c => c.quoi === 'Pong');
    // `keptAliveBy` nomme les MEMBRES dont les etendues tiennent les seules
    // mentions : ici `go`, la methode de l autre classe, pas la classe.
    expect(ping.preuve.verdict).toBe('island');
    expect(ping.preuve.gardePar).toEqual(['go']);
    expect(pong.preuve.gardePar).toEqual(['go']);
    expect(ping.preuve.mentions).toEqual({ tests: 0 });
  });
});

describe('T1, la preuve du balayage par fichier', () => {
  const SWEEP = f(`${KT}/Sweep.kt`, [
    'package com.x', '', 'import java.util.Locale', '',
    'fun compute(): Int {', '    var unusedCounter = 1', '    unusedCounter = 2', '    return 3', '}', '',
  ].join('\n'));
  const ENTREE = f(`${KT}/Entry.kt`, 'package com.x\n\nfun main() {\n    println(compute())\n}\n');

  it('un import jamais utilise est non reference, et la preuve garde son nom', () => {
    const c = coupes([GRADLE, SWEEP, ENTREE]).find(x => x.famille === 'balayage' && SWEEP.text.slice(x.start, x.end).includes('Locale')) as any;
    expect(c).toBeDefined();
    expect(c.preuve.verdict).toBe('unreferenced');
    expect(c.preuve.nom).toBe('java.util.Locale');
  });

  it('une variable ecrite et jamais lue est write-only', () => {
    const c = coupes([GRADLE, SWEEP, ENTREE]).find(x => x.famille === 'balayage' && SWEEP.text.slice(x.start, x.end).includes('unusedCounter')) as any;
    expect(c).toBeDefined();
    expect(c.preuve.verdict).toBe('write-only');
    expect(c.preuve.nom).toBe('unusedCounter');
  });
});

describe('T1, la preuve d une cle Remote Config compte ses variantes', () => {
  const DEFAUTS = (variante: string) => f(`/w/app/src/${variante}/res/xml/remote_config_defaults.xml`,
    ['<defaults>', '    <entry>', '        <key>enable_dark_mode</key>', '        <value>false</value>', '    </entry>', '</defaults>', ''].join('\n'));

  it('trois declarations, variantes = 3 sur chacune', () => {
    const rc = coupes([DEFAUTS('main'), DEFAUTS('debug'), DEFAUTS('release')]).filter(c => c.famille === 'remoteconfig') as any[];
    expect(rc).toHaveLength(3);
    for (const c of rc) expect(c.preuve).toEqual({ verdict: 'unreferenced', variantes: 3 });
  });
});
