import { describe, it, expect } from 'vitest';
import { explainIslands, findDeadIslands, javaAccessorIndex } from '../../../src/providers/deadIslands';

/**
 * KJ-046 — les îlots morts, mis à l'épreuve.
 *
 * Le terrain le plus dangereux de la famille : l'outil comparable y mesure
 * 57 % de faux positifs avec sa reachability. Le pari inverse tient à un
 * invariant : toute mention qu'on ne peut pas PROUVER à l'intérieur d'une
 * étendue candidate est une racine, et une racine = vie. Chaque erreur
 * d'approximation injecte de la vivacité, jamais de la mort.
 *
 * Limites assumées, documentées dans l'en-tête du module : les appelants
 * générés sous build/ sont invisibles (les gardes d'annotations I2 et la
 * convention I7 portent la sûreté), et un nom construit par concaténation
 * pour la réflexion est indétectable (maxIslandSize borne les dégâts).
 * L'audit Phase 0 sur 6410 fichiers : 26 îles, 25 vraies vérifiées à la
 * main ; le faux positif unique a produit I2 multi-lignes et I7.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const islands = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findDeadIslands({ sources, testSourceSets: TEST_SETS, ...extra })
    .map(i => i.members.map(m => (m.container ? `${m.container}.` : '') + m.name).sort());
const why = (sources: { path: string; text: string }[], name: string, extra: Record<string, unknown> = {}) =>
  explainIslands({ sources, testSourceSets: TEST_SETS, ...extra })
    .filter(e => e.name === name)
    .map(e => e.outcome);

// La paire mutuelle de référence, réutilisée par les tests de gardes : le
// cadavre témoin qui doit survivre à chaque garde (anti-silence, forme b).
const witnessA = f(`${MAIN}/WitnessA.kt`, 'package com.x\n\nfun witnessPing() {\n    witnessPong()\n}\n');
const witnessB = f(`${MAIN}/WitnessB.kt`, 'package com.x\n\nfun witnessPong() {\n    witnessPing()\n}\n');
const WITNESS = ['witnessPing', 'witnessPong'];

describe('attribution et étendues', () => {
  it('une mention dans un initialiseur top-level gardé est une racine', () => {
    // `private val` est le territoire de F1 : hors du pool, son initialiseur
    // ancre une racine — le mécanisme n° 1 de SDC (arête jetée) inversé.
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const holder = f(`${MAIN}/Holder.kt`, 'package com.x\n\nprivate val starter = ::ringA\n');
    expect(islands([island, holder, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('une valeur par défaut dans une fonction vivante propage la vie', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    // `render` est vivante (mention racine depuis un fichier gradle) ; sa
    // valeur par défaut mentionne ringA : la vie se propage par l'étendue.
    const live = f(`${MAIN}/Live.kt`, 'package com.x\n\nfun render(cb: () -> Unit = ::ringA) {\n    cb()\n}\n');
    const rooter = f('/w/app/build.gradle', 'apply from: "render"\n');
    expect(islands([island, live, rooter, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('le voisinage d’étendues ne déborde pas : la déclaration suivante garde ses mentions', () => {
    // Si l'étendue de deadA avalait la ligne de liveB, la mention racine de
    // ringA serait engloutie et l'île survivrait à tort.
    const src = f(`${MAIN}/Mix.kt`, [
      'package com.x',
      '',
      'fun deadA() {',
      '    deadB()',
      '}',
      'private fun liveB() {',
      '    ringA()',
      '}',
      'fun deadB() {',
      '    deadA()',
      '}',
      'fun ringA() {',
      '    ringB()',
      '}',
      'fun ringB() {',
      '    ringA()',
      '}',
    ].join('\n'));
    expect(islands([src])).toEqual([['deadA', 'deadB']]);
  });

  it('un commentaire ne fait pas vivre : la référence commentée est exactement le cas à signaler', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const doc = f(`${MAIN}/Doc.kt`, 'package com.x\n\n// see ringA and [com.x.ringB]\n/** ringA drives ringB */\nprivate val unrelated = 1\n');
    expect(islands([island, doc])).toEqual([['ringA', 'ringB']]);
  });

  it('un import simple ne fait pas vivre, comme partout dans la famille', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const importer = f('/w/app/src/main/kotlin/com/y/Use.kt', 'package com.y\n\nimport com.x.ringA\n\nprivate val other = 1\n');
    expect(islands([island, importer])).toEqual([['ringA', 'ringB']]);
  });

  it('l’import qui resterait pendu est listé avec l’île : la suppression est atomique', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const importer = f('/w/app/src/main/kotlin/com/y/Use.kt', 'package com.y\n\nimport com.x.ringA\n\nprivate val other = 1\n');
    const found = findDeadIslands({ sources: [island, importer], testSourceSets: TEST_SETS });
    expect(found[0].staleImports).toEqual([
      { path: '/w/app/src/main/kotlin/com/y/Use.kt', line: 2, name: 'ringA' },
    ]);
  });

  it('un segment capitalisé d’import est une dépendance structurelle : racine', () => {
    const outer = f(`${MAIN}/Outer.kt`, 'package com.x\n\nclass Outer {\n    class Nested\n\n    fun touch() = Nested()\n}\n');
    const importer = f('/w/app/src/main/kotlin/com/y/Use.kt', 'package com.y\n\nimport com.x.Outer.Nested\n\nprivate val other = 1\n');
    expect(islands([outer, importer, witnessA, witnessB])).toEqual([WITNESS]);
  });
});

describe('les homonymes empoisonnent vers le silence', () => {
  it('un porteur vivant du nom tait toute l’île : silence, prix assumé', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun bind() {\n    bindHelper()\n}\n\nfun bindHelper() {\n    bind()\n}\n');
    // Un troisième `bind` est appelé depuis du code gardé (racine).
    const live = f('/w/app/src/main/kotlin/com/y/Live.kt', 'package com.y\n\nfun bind(v: Int) = v\n');
    const caller = f('/w/app/src/main/kotlin/com/y/Caller.kt', 'package com.y\n\nprivate val cb = ::bind\n');
    expect(islands([island, live, caller, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('des homonymes tous morts fusionnent en UNE île, jamais en devinette', () => {
    // Mécanisme n° 2 de SDC inversé : la fusion de porteurs morts est un
    // choix de granularité de rapport, jamais une erreur de vie.
    const a = f(`${MAIN}/A.kt`, 'package com.x\n\nfun reset() {\n    resetHelper()\n}\n');
    const b = f(`${MAIN}/B.kt`, 'package com.x\n\nfun resetHelper() {\n    reset()\n}\n');
    const c = f('/w/app/src/main/kotlin/com/y/C.kt', 'package com.y\n\nfun reset() {\n    resetHelper()\n}\n');
    expect(islands([a, b, c])).toEqual([['reset', 'reset', 'resetHelper']]);
  });

  it('une sous-chaîne ne tait pas : fooBar vivant laisse l’île foo mourir', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun foo() {\n    fooHelper()\n}\n\nfun fooHelper() {\n    foo()\n}\n');
    const live = f('/w/app/build.gradle', 'tasks.register("fooBar")\n');
    expect(islands([island, live])).toEqual([['foo', 'fooHelper']]);
  });

  it('H9 : l’accesseur d’une propriété MAJUSCULES mappe à l’identique (la réfutation de l’île 22)', () => {
    // Cas réel du contre-examen : PageViewBuilder.java appelle
    // ObjectType.Companion.getIGNORED_CHILD_CLASSES(). Pour une propriété
    // ALL_CAPS, l'accesseur Kotlin est `get` + nom IDENTIQUE — la
    // décapitalisation seule (getFoo → foo) ne retombe jamais dessus, et la
    // constante sortait morte à tort. Un FP réel, attrapé par l'audit.
    const holder = f(`${MAIN}/ObjectHolder.kt`, [
      'package com.x',
      '',
      'class ObjectHolder {',
      '    companion object {',
      '        val IGNORED_ONES: List<Int> = listOf(1)',
      '    }',
      '}',
    ].join('\n'));
    // Le fichier Java a un `static void main` : exempt en bloc (F9j), donc
    // son appel d'accesseur est une RACINE — comme le vrai PageViewBuilder
    // est vivant via PageController.
    const javaCaller = f('/w/app/src/main/java/com/y/Builder.java', [
      'package com.y;',
      '',
      'class Builder {',
      '    public static void main(String[] args) {',
      '        ObjectHolder.Companion.getIGNORED_ONES().contains(1);',
      '    }',
      '}',
    ].join('\n'));
    expect(islands([holder, javaCaller, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('H9 : getGhost() épelé depuis du code VIVANT fait vivre la propriété ghost et son île', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nval ghost = ghostSource()\n\nfun ghostSource(): Int {\n    println(ghost)\n    return 1\n}\n');
    // Use est enraciné par le manifest : son appel accesseur compte. Un
    // appelant lui-même mort n'aurait rien prouvé (c'est le point du détecteur).
    const javaCaller = f('/w/app/src/main/java/com/y/Use.java', 'package com.y;\n\nclass Use {\n    static { AKt.getGhost(); }\n}\n');
    const manifest = f('/w/app/src/main/AndroidManifest.xml', '<application android:name="com.y.Use" />');
    expect(islands([island, javaCaller, manifest, witnessA, witnessB])).toEqual([WITNESS]);
  });
});

describe('les racines non-code', () => {
  const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');

  it('un token en layout XML est une racine', () => {
    const xml = f('/w/app/src/main/res/layout/a.xml', '<View android:onClick="ringA" />');
    expect(islands([island, xml, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('un token en proguard est une racine', () => {
    const pro = f('/w/app/proguard-rules.pro', '-keepclassmembers class * { *** ringA(...); }\n');
    expect(islands([island, pro, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('un token dans le manifest est une racine', () => {
    const manifest = f('/w/app/src/main/AndroidManifest.xml', '<activity android:name=".ringA" />');
    expect(islands([island, manifest, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('un token en .toml ou .properties est une racine', () => {
    const toml = f('/w/gradle/libs.versions.toml', '[plugins]\nringA = { id = "x" }\n');
    expect(islands([island, toml, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('une chaîne littérale dans du code gardé est une racine (réflexion par nom)', () => {
    const reflective = f(`${MAIN}/R.kt`, 'package com.x\n\nprivate val target = "ringA"\n');
    expect(islands([island, reflective, witnessA, witnessB])).toEqual([WITNESS]);
  });
});

describe('les gardes', () => {
  it('I2 : F3 court-circuite F5, la passe positionnelle rattrape l’annotation', () => {
    // Le faux positif unique de l'audit Phase 0 : deux ApplicationComponent
    // homonymes AVEC mentions internes (le retour de leur Factory) ⇒ pas de
    // sauvetage KJ-036 ⇒ F3:duplicate-name masque F5:@Component
    // (unusedSymbols.ts:650 avant :655), et la règle « F3 reste éligible »
    // laissait entrer du Dagger dans le pool. La passe I2 revérifie les
    // annotations par position, insensible à l'ordre des gardes.
    const a = f(`${MAIN}/di/AppComponent.kt`, [
      'package com.x.di',
      '',
      '@Component(',
      '    modules = [MainModule::class]',
      ')',
      'interface AppComponent {',
      '    fun inject(target: MainModule)',
      '',
      '    fun again(): AppComponent?',
      '}',
    ].join('\n'));
    const b = f('/w/demo/src/main/kotlin/com/y/AppComponent.kt', [
      'package com.y',
      '',
      '@Component(modules = [MainModule::class])',
      'interface AppComponent {',
      '    fun inject(target: MainModule)',
      '',
      '    fun again(): AppComponent?',
      '}',
    ].join('\n'));
    const module = f(`${MAIN}/MainModule.kt`, 'package com.x\n\nclass MainModule {\n    fun provide(): Int = 1\n}\n');
    expect(islands([a, b, module, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([a, b, module], 'AppComponent')).toEqual(['I2:@Component', 'I2:@Component']);
  });

  it('F5 via l’éligibilité : une annotation étrangère sur un nom unique est déjà gardée', () => {
    const component = f(`${MAIN}/Di.kt`, [
      'package com.x',
      '',
      '@Component(',
      '    modules = [MainModule::class]',
      ')',
      'interface LoneComponent {',
      '    fun inject(target: MainModule)',
      '}',
    ].join('\n'));
    const module = f(`${MAIN}/MainModule.kt`, 'package com.x\n\nclass MainModule {\n    fun provide(): Int = 1\n}\n');
    expect(islands([component, module, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([component, module], 'LoneComponent')).toEqual(['F5:@Component']);
  });

  it('I2 : une annotation bénigne multi-lignes ne protège pas', () => {
    const a = f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      '@Deprecated(',
      '    message = "old"',
      ')',
      'fun ringA() {',
      '    ringB()',
      '}',
      '',
      'fun ringB() {',
      '    ringA()',
      '}',
    ].join('\n'));
    expect(islands([a])).toEqual([['ringA', 'ringB']]);
  });

  it('I7 : Dagger<N> mentionné sans déclaration propre enracine <N>', () => {
    const component = f(`${MAIN}/AppComponent.kt`, 'package com.x\n\ninterface AppComponent {\n    fun wire(m: WireModule)\n}\n\nclass WireModule {\n    fun of(): AppComponent? = null\n}\n');
    const app = f(`${MAIN}/App.kt`, 'package com.x\n\nprivate val graph = "DaggerAppComponent"\n');
    expect(islands([component, app, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([component, app], 'AppComponent')[0]).toContain('generated DaggerAppComponent');
  });

  it('I7 : un Dagger<N> déclaré dans le corpus n’est pas de la génération', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    // `DaggerringA` n'existe pas ; `DaggerTool` déclaré ici ne parle pas de ringA.
    const decoy = f(`${MAIN}/DaggerTool.kt`, 'package com.x\n\nclass DaggerTool\n\nprivate val keep = DaggerTool()\n');
    expect(islands([island, decoy])).toEqual([['ringA', 'ringB']]);
  });

  it('F7 via l’éligibilité : une classe au supertype framework enracine son contenu', () => {
    const screen = f(`${MAIN}/Screen.kt`, 'package com.x\n\nclass Screen : Activity() {\n    fun open() = helperShow()\n}\n\nfun helperShow() {\n    println("x")\n}\n');
    expect(islands([screen, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('F9 via l’éligibilité : main est hors pool, son corps est une racine', () => {
    const entry = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    ringA()\n}\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    expect(islands([entry, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('F4 via l’éligibilité : expect/actual reste hors jeu', () => {
    const kmp = f(`${MAIN}/Kmp.kt`, 'package com.x\n\nexpect fun bridgeCall()\n\nfun bridgeUser() {\n    bridgeCall()\n}\n');
    // `bridgeCall` gardée (F4) ⇒ hors pool ; `bridgeUser` seul n'est pas une
    // île nouvelle : KJ-032 le possède déjà (I6).
    expect(islands([kmp, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('le marqueur ignore d’un fichier tait son île entière', () => {
    const a = f(`${MAIN}/A.kt`, 'package com.x\n\n// kotlin-jump:ignore dead-island\nfun ringA() {\n    ringB()\n}\n');
    const b = f(`${MAIN}/B.kt`, 'package com.x\n\nfun ringB() {\n    ringA()\n}\n');
    expect(islands([a, b, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('ignoreNames tait l’île au premier membre ignoré', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    expect(islands([island, witnessA, witnessB], { ignoreNames: ['ringA'] })).toEqual([WITNESS]);
    expect(why([island], 'ringB', { ignoreNames: ['ringA'] })).toEqual(['I2:ignored-name']);
  });

  it('I8 : au-delà de maxIslandSize, on retient tout, jamais un morceau', () => {
    const chain = f(`${MAIN}/Chain.kt`, [
      'package com.x',
      '',
      'fun hopA() {',
      '    hopB()',
      '}',
      'fun hopB() {',
      '    hopC()',
      '}',
      'fun hopC() {',
      '    hopA()',
      '}',
    ].join('\n'));
    expect(islands([chain], { maxIslandSize: 2 })).toEqual([]);
    expect(why([chain], 'hopB', { maxIslandSize: 2 })).toEqual(['I8:max-size']);
    expect(islands([chain], { maxIslandSize: 3 })).toEqual([['hopA', 'hopB', 'hopC']]);
  });

  it('un fichier généré est hors pool : son contenu enracine', () => {
    const gen = f(`${MAIN}/Gen.kt`, '// auto generated by OpenAPI Generator. Do not edit.\npackage com.x\n\nfun genCaller() {\n    ringA()\n}\n');
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    expect(islands([gen, island, witnessA, witnessB])).toEqual([WITNESS]);
  });
});

describe('les verdicts', () => {
  it('une mention de test rend l’île entière testOnly', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const test = f('/w/app/src/test/kotlin/com/x/T.kt', 'package com.x\n\nfun t() {\n    ringA()\n}\n');
    const found = findDeadIslands({ sources: [island, test], testSourceSets: TEST_SETS });
    expect(found.map(i => i.verdict)).toEqual(['testOnly']);
    expect(found[0].testMentions).toBeGreaterThan(0);
  });

  it('includeTestOnly: false retire l’île testOnly, pas les autres', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const test = f('/w/app/src/test/kotlin/com/x/T.kt', 'package com.x\n\nfun t() {\n    ringA()\n}\n');
    expect(islands([island, test, witnessA, witnessB], { includeTestOnly: false })).toEqual([WITNESS]);
  });
});

describe('la population', () => {
  it('une île traverse les classes et les fichiers', () => {
    const a = f(`${MAIN}/Sync.kt`, 'package com.x\n\nclass LegacySync {\n    fun push() = Uploader.send()\n}\n');
    const b = f(`${MAIN}/Uploader.kt`, 'package com.x\n\nobject Uploader {\n    fun send(): LegacySync? = null\n}\n');
    expect(islands([a, b])).toEqual([['LegacySync', 'LegacySync.push', 'Uploader', 'Uploader.send']]);
  });

  it('interface + unique implémentation sans appelant : l’île répare le FN documenté de KJ-042', () => {
    // KJ-042 documente ce silence (le token de l'override maintient la
    // méthode d'interface). L'attribution le perce : l'override vit DANS
    // l'étendue de sa classe, morte elle aussi.
    const i = f(`${MAIN}/Port.kt`, 'package com.x\n\ninterface Port {\n    fun push()\n}\n');
    const c = f(`${MAIN}/Adapter.kt`, 'package com.x\n\nclass Adapter : Port {\n    override fun push() {\n        println("x")\n    }\n}\n');
    expect(islands([i, c])).toEqual([['Adapter', 'Port']]);
  });

  it('un membre de companion appartient à l’île, à travers les classes', () => {
    const holder = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder {',
      '    companion object {',
      '        const val MARK = "HOLDER"',
      '    }',
      '}',
    ].join('\n'));
    // Writer tient Holder et MARK en vie aux yeux du sac ; personne ne tient
    // Writer. L'île = write et ses otages ; la classe Writer elle-même est
    // une composante à part, déjà possédée par KJ-032 (une trouvaille par
    // cause, granularité assumée).
    const writer = f(`${MAIN}/Writer.kt`, 'package com.x\n\nclass Writer {\n    fun write() = Holder.MARK\n}\n');
    expect(islands([holder, writer]))
      .toEqual([['Holder', 'Holder.Companion.MARK', 'Writer.write']]);
    expect(why([holder, writer], 'Writer')).toEqual(['I6:subsumed']);
  });

  it('classe + membres seuls chez eux : tout est déjà possédé individuellement, I6 subsume', () => {
    const holder = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder {',
      '    fun stamp() = MARK',
      '',
      '    companion object {',
      '        const val MARK = "HOLDER"',
      '    }',
      '}',
    ].join('\n'));
    expect(islands([holder, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([holder], 'MARK')).toEqual(['I6:subsumed']);
  });

  it('membre d’interface sans corps sous une interface vivante : silence, FN documenté', () => {
    // La population reste celle de KJ-032/042, qui refuse les méthodes
    // d'interface sans corps (« rien à délimiter » — le bucket où vivent 121
    // trouvailles de l'outil comparable, en plein terrain de ses 57 % de
    // faux positifs). Sans nœud propre, la déclaration du membre vit dans
    // l'étendue de son interface : une interface vivante vivifie ses membres
    // et leurs otages. Prix mesuré au re-scan Phase 1 : deux îles testOnly
    // perdues sur 25 vraies. Extension possible en v2, gardes à l'appui.
    const contract = f(`${MAIN}/UseCase.kt`, [
      'package com.x',
      '',
      'interface UseCase {',
      '    fun activeTask(): Int',
      '',
      '    fun ghostTask(): GhostConfig',
      '}',
    ].join('\n'));
    const config = f(`${MAIN}/GhostConfig.kt`, 'package com.x\n\nclass GhostConfig {\n    fun ghostTaskDefault(): Int = 1\n}\n');
    const live = f(`${MAIN}/Caller.kt`, 'package com.x\n\nprivate val use: UseCase? = null\nprivate val n = use?.activeTask()\n');
    expect(islands([contract, config, live, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([contract, config, live], 'GhostConfig')).toEqual(['alive:via UseCase']);
  });

  it('une île Java existe aussi', () => {
    const a = f('/w/app/src/main/java/com/x/Ping.java', 'package com.x;\n\npublic class Ping {\n    void go() { Pong.back(); }\n}\n');
    const b = f('/w/app/src/main/java/com/x/Pong.java', 'package com.x;\n\npublic class Pong {\n    static void back() { new Ping(); }\n}\n');
    const found = islands([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('Ping');
    expect(found[0]).toContain('Pong');
  });

  it('la const auto-référente par sa propre chaîne est une île de taille 1', () => {
    // Trouvé en Phase 0 : `X = "X"` se maintenait en vie par sa chaîne aux
    // yeux du sac ; l'attribution voit qu'elle est chez elle.
    const holder = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder {',
      '    companion object {',
      '        const val EXTRA_MODE = "EXTRA_MODE"',
      '    }',
      '}',
    ].join('\n'));
    const rooter = f('/w/app/src/main/res/layout/a.xml', '<View class="com.x.Holder" />');
    expect(islands([holder, rooter])).toEqual([['Holder.Companion.EXTRA_MODE']]);
  });
});

describe('l’amplification refusée et le contrat', () => {
  it('UNE mention externe d’UN membre dissout l’île entière, jamais un reste', () => {
    // Mécanisme n° 5 de SDC inversé : l'erreur amplifie la vie.
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const graze = f('/w/app/proguard-rules.pro', '-keep class ringB\n');
    expect(islands([island, graze])).toEqual([]);
  });

  it('un singleton auto-récursif appartient à KJ-032 : subsumé, une trouvaille par cause', () => {
    const solo = f(`${MAIN}/Solo.kt`, 'package com.x\n\nfun soloLoop() {\n    soloLoop()\n}\n');
    expect(islands([solo, witnessA, witnessB])).toEqual([WITNESS]);
    expect(why([solo], 'soloLoop')).toEqual(['I6:subsumed']);
  });

  it('un corpus tronqué ne produit rien', () => {
    expect(islands([witnessA, witnessB])).toEqual([WITNESS]);
    expect(islands([witnessA, witnessB], { truncated: true })).toEqual([]);
  });

  it('un objet anonyme n’entraîne pas son supertype dans une île', () => {
    // Trouvé sur le dépôt kotlin-lsp : le symbole synthétique `$anon$N` du
    // parseur passait pour une déclaration morte, puis emportait avec lui la
    // classe qu'il implémente, vivante, dans une île à deux membres
    // (« kept alive only by: $anon$24 — themselves dead »).
    const base = f(`${MAIN}/Hover.kt`, 'package com.x\n\nopen class HoverProvider {\n    open fun go() = 1\n}\n');
    const anon = f(`${MAIN}/Config.kt`, 'package com.x\n\nval config = listOf(\n    object : HoverProvider() { },\n)\n');
    expect(islands([base, anon, witnessA, witnessB])).toEqual([WITNESS]);
  });

  it('chaque candidat brut a un outcome : le --why rend compte de tout', () => {
    const island = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const live = f(`${MAIN}/Live.kt`, 'package com.x\n\nfun shown() {\n    println("x")\n}\n');
    const xml = f('/w/app/src/main/res/layout/a.xml', '<View android:onClick="shown" />');
    const rows = explainIslands({ sources: [island, live, xml], testSourceSets: TEST_SETS });
    expect(rows.find(r => r.name === 'ringA')?.outcome).toMatch(/^island#/);
    expect(rows.find(r => r.name === 'shown')?.outcome).toMatch(/^alive:root/);
    expect(rows.every(r => r.outcome !== 'unaccounted')).toBe(true);
  });
});

describe('H9 inversée côté Kotlin : les îlots et KJ-042 disent la même chose', () => {
  const JAVA = '/w/app/src/main/java/com/x/Foo.java';
  const FOO = 'package com.x;\n\npublic class Foo {\n    public String getBar() { return "x"; }\n}\n';

  it('un getter Java lu comme propriété depuis Kotlin n’est pas une île', () => {
    // Avant : l’île ["Foo.getBar"], parce que la moisson cherchait le jeton
    // `getBar`, que Kotlin n’écrit jamais. Trouvé sur un monorepo réel, où
    // six accesseurs vivants étaient rapportés, dont un lu par un ViewModel.
    const java = f(JAVA, FOO);
    const kt = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    val f = Foo()\n    println(f.bar)\n}\n');
    expect(islands([java, kt])).toEqual([]);
  });

  it('lu depuis du code lui-même mort, le lecteur entre dans l’île', () => {
    // La contribution est une ARÊTE, pas une vie : c’est ce qui distingue
    // l’analyse d’îlots du simple comptage de mentions de KJ-042.
    const java = f(JAVA, FOO);
    const alive = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    val f = Foo()\n    println(f)\n}\n');
    const dead = f(`${MAIN}/Dead.kt`, 'package com.x\n\nfun deadReader() {\n    val f = Foo()\n    println(f.bar)\n}\n');
    expect(islands([java, alive, dead])).toEqual([['Foo.getBar', 'deadReader']]);
  });

  it('isX() n’a besoin d’aucune correspondance : le jeton est déjà le nom', () => {
    const java = f(JAVA, 'package com.x;\n\npublic class Foo {\n    public boolean isReady() { return true; }\n}\n');
    const kt = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    val f = Foo()\n    println(f.isReady)\n}\n');
    expect(islands([java, kt])).toEqual([]);
  });
});

describe('javaAccessorIndex : la restriction Java, que la surface des îlots ne peut pas exercer', () => {
  // Un `getX` déclaré en Kotlin dont la classe est vivante est revendiqué par
  // KJ-042 avant d’atteindre les îlots : la garde se teste donc ici.
  const node = (name: string, path: string, kind = 'fun') => ({ name, kind, path });

  it('un accesseur Java entre sous son nom nu', () => {
    const index = javaAccessorIndex([node('getBar', 'a/Foo.java')]);
    expect(index.get('bar')).toEqual(['getBar']);
  });

  it('un setter Java entre aussi sous isX, pour la paire isX()/setX()', () => {
    const index = javaAccessorIndex([node('setBar', 'a/Foo.java')]);
    expect(index.get('bar')).toEqual(['setBar']);
    expect(index.get('isBar')).toEqual(['setBar']);
  });

  it('getX et setX de la même propriété partagent la clé', () => {
    const index = javaAccessorIndex([node('getBar', 'a/Foo.java'), node('setBar', 'a/Foo.java')]);
    expect(index.get('bar')).toEqual(['getBar', 'setBar']);
  });

  it('un accesseur déclaré en KOTLIN reste dehors', () => {
    expect(javaAccessorIndex([node('getBar', 'a/Foo.kt')]).size).toBe(0);
  });

  it('ni une propriété, ni un nom qui commence par get sans majuscule', () => {
    expect(javaAccessorIndex([node('getBar', 'a/Foo.java', 'val')]).size).toBe(0);
    expect(javaAccessorIndex([node('gettysburg', 'a/Foo.java')]).size).toBe(0);
  });
});
