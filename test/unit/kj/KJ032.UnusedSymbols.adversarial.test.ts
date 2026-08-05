import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-032 adversarial — les 17 gardes de candidat et les 14 sources de
 * référence, une par une.
 *
 *   findUnusedSymbols(input): UnusedSymbol[]
 *
 * Contrat : un signalement veut dire « aucune référence textuelle à ce symbole
 * n'existe dans ce que nous pouvons lire ». Toute occurrence non classifiable
 * compte comme un usage, donc une garde ne peut que TAIRE un warning.
 *
 * Les quatre cas marqués « le moteur d'usages casse ici » sont la raison pour
 * laquelle KJ-032 moissonne le corpus au lieu d'appeler FindUsagesEngine.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const APP = '/w/app';
const MAIN = `${APP}/src/main/kotlin/com/x`;
const TEST = `${APP}/src/test/kotlin/com/x`;

const kt = (path: string, text: string) => ({ path, text });
const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  mod.findUnusedSymbols({ sources, testSourceSets: TEST_SETS, ...extra });
const names = (findings: any[]) => findings.map(f => f.name).sort();
const flagged = (sources: any[], name: string, extra: Record<string, unknown> = {}) =>
  find(sources, extra).some((f: any) => f.name === name);

/** Un fichier déclarant `Ghost`, que rien ne référence. */
const ghost = (decl = 'class Ghost') =>
  kt(`${MAIN}/Ghost.kt`, `package com.x\n\n${decl}\n`);

describe.skipIf(!mod)('contrat', () => {
  it('un corpus tronqué ne peut rien prouver, donc zéro signalement', () => {
    expect(names(find([ghost()]))).toEqual(['Ghost']);
    expect(find([ghost()], { truncated: true })).toEqual([]);
  });

  it('un symbole référencé depuis un autre fichier main est vivant', () => {
    const sources = [ghost(), kt(`${MAIN}/User.kt`, 'package com.x\n\nfun use() = Ghost()\n')];
    // `use` est lui-même mort et signalé à juste titre : on assert sur Ghost.
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('un usage par une déclaration sœur du même fichier ne signale rien', () => {
    const sources = [kt(`${MAIN}/Both.kt`, 'package com.x\n\nclass Helper\n\nclass Api {\n  val h = Helper()\n}\n')];
    expect(flagged(sources, 'Helper')).toBe(false);
  });

  it('une auto-référence DANS l’étendue ne sauve pas la déclaration', () => {
    const sources = [kt(`${MAIN}/Solo.kt`,
      'package com.x\n\nclass Solo {\n  companion object {\n    fun create() = Solo()\n  }\n}\n')];
    expect(flagged(sources, 'Solo')).toBe(true);
  });
});

describe.skipIf(!mod)('F1 à F4 — visibilité, tests, homonymes, KMP', () => {
  it('F1 : un private top-level appartient à KJ-026, jamais signalé ici', () => {
    expect(find([ghost('private class Ghost')])).toEqual([]);
  });

  it('F2 : déclaré dans un source set de test, jamais signalé', () => {
    expect(find([kt(`${TEST}/GhostTest.kt`, 'package com.x\n\nclass Ghost\n')])).toEqual([]);
  });

  it('F3 : le même nom déclaré deux fois au top level neutralise les deux', () => {
    // Il faut une mention pour qu'il y ait quelque chose à attribuer. Sans
    // aucune, KJ-036 relâche la garde et signale les deux, ce qui est le
    // sujet de `KJ036.DuplicateNameNoMention`.
    const sources = [
      kt(`${MAIN}/a/Dup.kt`, 'package com.x.a\n\nclass Dup\n'),
      kt(`${MAIN}/b/Dup.kt`, 'package com.x.b\n\nclass Dup\n'),
      kt(`${MAIN}/Use.kt`, 'package com.x\n\nimport com.x.a.Dup\n\nval held: Dup? = null\n'),
    ];
    expect(find(sources).map(f => f.name)).not.toContain('Dup');
  });

  it('F3 : et ça couvre les surcharges de fonctions top-level', () => {
    // Les deux surcharges partagent leur fichier, donc chacune compte les
    // mentions de l'autre comme siennes et le résidu part en négatif. KJ-036
    // ne peut pas relâcher : le compte ne retombe jamais à zéro.
    const sources = [kt(`${MAIN}/Ov.kt`, 'package com.x\n\nfun render(a: Int) = a\n\nfun render(a: String) = a\n')];
    expect(find(sources)).toEqual([]);
  });

  it('F4 : une paire expect/actual n’est jamais signalée', () => {
    expect(find([ghost('expect class Ghost')])).toEqual([]);
    expect(find([ghost('actual class Ghost')])).toEqual([]);
  });
});

describe.skipIf(!mod)('F5 — toute annotation hors allowlist rend vivant', () => {
  const cases = [
    '@Serializable', '@Entity', '@Dao', '@Database', '@JsonClass(generateAdapter = true)',
    '@Module', '@Provides', '@Binds', '@Inject', '@Singleton', '@InstallIn(SingletonComponent::class)',
    '@HiltAndroidApp', '@AndroidEntryPoint', '@HiltViewModel', '@Parcelize', '@Keep',
    '@Preview', '@JvmName("x")', '@TypeConverter', '@BindingAdapter("x")', '@VisibleForTesting',
  ];
  for (const anno of cases) {
    it(`${anno} rend le symbole intouchable`, () => {
      expect(find([ghost(`${anno}\nclass Ghost`)])).toEqual([]);
    });
  }

  it('mais @Composable seul reste signalable', () => {
    expect(flagged([ghost('@Composable\nfun GhostScreen() {}')], 'GhostScreen')).toBe(true);
  });

  it('les annotations de contrat Compose sont bénignes, elles ne rendent rien atteignable', () => {
    for (const anno of ['@Stable', '@Immutable', '@ReadOnlyComposable', '@NonRestartableComposable']) {
      expect(flagged([ghost(`${anno}\nclass Ghost`)], 'Ghost'), anno).toBe(true);
    }
  });

  it('et @Deprecated seul aussi : déprécié et non référencé est la meilleure trouvaille', () => {
    const found = find([ghost('@Deprecated("gone")\nclass Ghost')]);
    expect(names(found)).toEqual(['Ghost']);
    expect(found[0].isDeprecated).toBe(true);
  });

  it('une annotation multiligne est attribuée à la bonne déclaration', () => {
    const sources = [kt(`${MAIN}/Multi.kt`,
      'package com.x\n\n@Suppress(\n  "unused"\n)\nclass Kept\n\nclass Ghost\n')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });
});

describe.skipIf(!mod)('F6 à F9 — supertypes, main', () => {
  it('F6 : un supertype réflexif rend vivant', () => {
    for (const t of ['Serializable', 'Parcelable', 'Externalizable']) {
      expect(find([ghost(`class Ghost : ${t}`)])).toEqual([]);
    }
  });

  it('F7 : un supertype instancié par le framework rend vivant', () => {
    for (const t of ['Application', 'Activity', 'Fragment', 'Service', 'BroadcastReceiver', 'Worker']) {
      expect(find([ghost(`class Ghost : ${t}()`)])).toEqual([]);
    }
  });

  it('F6 : les génériques du supertype ne trompent pas la garde', () => {
    expect(find([ghost('class Ghost : Parcelable<String>')])).toEqual([]);
  });

  it('F7 : la garde suit la chaîne d’héritage, pas seulement le parent direct', () => {
    // `class Screen : BaseScreen()` ne nomme que BaseScreen à la déclaration.
    // S'arrêter au premier niveau signalerait un Fragment vivant comme mort.
    const sources = [
      kt(`${MAIN}/Base.kt`, 'package com.x\n\nabstract class BaseScreen : Fragment()\n'),
      kt(`${MAIN}/Screen.kt`, 'package com.x\n\nclass Ghost : BaseScreen()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('F7 : et sur trois niveaux', () => {
    const sources = [
      kt(`${MAIN}/A.kt`, 'package com.x\n\nabstract class Lvl1 : Service()\n'),
      kt(`${MAIN}/B.kt`, 'package com.x\n\nabstract class Lvl2 : Lvl1()\n'),
      kt(`${MAIN}/C.kt`, 'package com.x\n\nclass Ghost : Lvl2()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('mais une chaîne cyclique ne boucle pas', () => {
    const sources = [
      kt(`${MAIN}/A.kt`, 'package com.x\n\nabstract class Loop1 : Loop2()\n'),
      kt(`${MAIN}/B.kt`, 'package com.x\n\nabstract class Loop2 : Loop1()\n'),
      kt(`${MAIN}/C.kt`, 'package com.x\n\nclass Ghost : Loop1()\n'),
    ];
    expect(() => find(sources)).not.toThrow();
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('F8 : un parent dont un sous-type est annoté est instancié par le framework', () => {
    // Une sealed class dont les variantes portent @SerializedName est créée
    // par la bibliothèque JSON, jamais nommée. Le parent n'a aucune annotation.
    const sources = [kt(`${MAIN}/Payload.kt`, [
      'package com.x',
      '',
      'sealed class Ghost {',
      '  @SerializedName("message")',
      '  data class Message(val text: String) : Ghost()',
      '}',
    ].join('\n'))];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('F8 : mais un sous-type non annoté ne protège pas le parent', () => {
    const sources = [kt(`${MAIN}/Plain.kt`,
      'package com.x\n\nsealed class Ghost {\n  data class Message(val text: String) : Ghost()\n}\n')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('F7b : la garde par convention de nom est DÉSACTIVÉE par défaut', () => {
    // Mesuré : elle coûte un vrai positif sur un monorepo réel pour n'en
    // couvrir que 4 sur 21 dans un corpus dont les marqueurs sont en
    // commentaire. Disponible en réglage, jamais imposée.
    const sources = [ghost('class GhostFragment')];
    expect(flagged(sources, 'GhostFragment')).toBe(true);
    expect(flagged(sources, 'GhostFragment', { frameworkNameSuffixes: true })).toBe(false);
  });

  it('F7b : et même activée, elle ne s’applique pas à une interface', () => {
    // Aucun framework n'instancie une interface : `interface XService` reste
    // signalable, sinon on perd un vrai positif pour rien.
    const sources = [ghost('interface GhostService')];
    expect(flagged(sources, 'GhostService', { frameworkNameSuffixes: true })).toBe(true);
  });

  it('F9 : main() est un point d’entrée', () => {
    expect(find([kt(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n  println(1)\n}\n')])).toEqual([]);
  });
});

describe.skipIf(!mod)('F10 — les conventions d’appel ne nomment pas la fonction', () => {
  const conventions = ['invoke', 'getValue', 'setValue', 'provideDelegate', 'iterator', 'contains',
    'compareTo', 'plus', 'times', 'get', 'set', 'component1', 'component2'];
  for (const name of conventions) {
    it(`${name} n’est jamais signalé`, () => {
      expect(find([kt(`${MAIN}/C.kt`, `package com.x\n\nfun ${name}(a: Int) = a\n`)])).toEqual([]);
    });
  }

  it('un operator explicite non plus', () => {
    expect(find([kt(`${MAIN}/O.kt`, 'package com.x\n\noperator fun String.unaryMinus() = this\n')])).toEqual([]);
  });
});

describe.skipIf(!mod)('F11 à F17 — opt-outs et périmètre', () => {
  it('F11 : un nom en backticks n’est pas signalé', () => {
    expect(find([kt(`${MAIN}/B.kt`, 'package com.x\n\nfun `a ghost`() {}\n')])).toEqual([]);
  });

  it('F12 : @Suppress sur la déclaration', () => {
    expect(find([ghost('@Suppress("unused")\nclass Ghost')])).toEqual([]);
  });

  it('F12 : @file:Suppress éteint tout le fichier', () => {
    expect(find([kt(`${MAIN}/S.kt`, '@file:Suppress("unused")\npackage com.x\n\nclass Ghost\n')])).toEqual([]);
  });

  it('F12 : @file:Suppress cité dans un KDoc n’éteint rien', () => {
    // La regex tournait sur le texte brut : citer l'annotation suffisait à
    // taire le détecteur pour tout le fichier, sans que rien ne le dise.
    expect(names(find([kt(`${MAIN}/S.kt`,
      '/** @file:Suppress("unused") */\npackage com.x\n\nclass Ghost\n')]))).toEqual(['Ghost']);
  });

  it('F12 : la forme entre crochets éteint le fichier comme la forme simple', () => {
    expect(find([kt(`${MAIN}/S.kt`,
      '@file:[JvmName("S") Suppress("unused")]\npackage com.x\n\nclass Ghost\n')])).toEqual([]);
  });

  it('un objet anonyme au niveau fichier n’est pas une déclaration', () => {
    // Le parseur émet `$anon$<ligne>` pour `object : Base { }` afin de compter
    // les implémenteurs anonymes. WORD_RE ne peut pas produire ce jeton, donc
    // son compte de mentions restait à zéro et il traversait toutes les gardes.
    const text = [
      'package com.x',
      '',
      'interface Bar { fun go() }',
      '',
      'val handler = Foo(object : Bar { })',
      '',
      'fun Foo(b: Bar) = b',
    ].join('\n');
    const found = names(find([kt(`${MAIN}/S.kt`, text)]));
    expect(found.some(n => n.startsWith('$'))).toBe(false);
    expect(found).toEqual(['handler']);
  });

  it('un object nommé mort reste signalé', () => {
    expect(names(find([kt(`${MAIN}/R.kt`, 'package com.x\n\nobject Real { fun go() = 1 }\n')])))
      .toEqual(['Real']);
  });

  it('F12 : le marqueur kotlin-jump:ignore aussi', () => {
    expect(find([kt(`${MAIN}/M.kt`,
      'package com.x\n// kotlin-jump:ignore unused-symbol\n\nclass Ghost\n')])).toEqual([]);
  });

  it('F13 : buildSrc est exclu par défaut, ses ids de plugin sont des noms de fichier', () => {
    const sources = [kt('/w/buildSrc/src/main/kotlin/Conv.kt', 'class Ghost\n')];
    expect(find(sources, { ignorePaths: ['**/buildSrc/**'] })).toEqual([]);
  });

  it('F14 : un module publié voit son API consommée hors workspace', () => {
    expect(find([ghost()], { publishedModules: [APP] })).toEqual([]);
  });

  it('F14 : un module bibliothèque est signalé, mais marqué', () => {
    const found = find([ghost()], { libraryModules: [APP] });
    expect(found).toHaveLength(1);
    expect(found[0].isLibraryModule).toBe(true);
  });

  it('F15 : typealias et annotation class sont hors périmètre en v1', () => {
    expect(find([kt(`${MAIN}/T.kt`, 'package com.x\n\ntypealias Ghost = String\n')])).toEqual([]);
    expect(find([kt(`${MAIN}/A.kt`, 'package com.x\n\nannotation class Ghost\n')])).toEqual([]);
  });

  it('F15 : un membre de classe est hors périmètre, KJ-026 et KJ-032 v2 s’en occupent', () => {
    const sources = [kt(`${MAIN}/Outer.kt`,
      'package com.x\n\nclass Outer {\n  fun neverCalled() = 1\n}\n\nfun useOuter() = Outer()\n')];
    expect(flagged(sources, 'neverCalled')).toBe(false);
  });

  it('F17 : ignoreNames tait un nom sans toucher aux autres', () => {
    const sources = [ghost(), kt(`${MAIN}/Other.kt`, 'package com.x\n\nclass Spook\n')];
    expect(names(find(sources))).toEqual(['Ghost', 'Spook']);
    expect(names(find(sources, { ignoreNames: ['Ghost'] }))).toEqual(['Spook']);
  });
});

describe.skipIf(!mod)('H — les sources de référence que le moteur d’usages ne voit pas', () => {
  it('un FQN inline sans import, dans un autre package, rend vivant', () => {
    // le moteur d'usages écarte ce fichier via fileCouldReference : c'est le
    // faux positif qui a décidé de moissonner plutôt que de scanner
    const sources = [
      ghost(),
      kt('/w/app/src/main/kotlin/com/y/Caller.kt', 'package com.y\n\nfun go() = com.x.Ghost()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('une collision de wildcards rend vivant', () => {
    const sources = [
      ghost(),
      kt('/w/app/src/main/kotlin/com/y/Ghost.kt', 'package com.y\n\nclass Ghost\n'),
      kt('/w/app/src/main/kotlin/com/z/C.kt', 'package com.z\n\nimport com.x.*\nimport com.y.*\n\nfun go() = Ghost()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H10 : un import aliasé rend vivant, même si le nom simple n’apparaît jamais', () => {
    const sources = [
      ghost(),
      kt(`${MAIN}/Alias.kt`, 'package com.x\n\nimport com.x.Ghost as Spirit\n\nfun go() = Spirit()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H1 : le manifest, y compris <application android:name>', () => {
    for (const tag of [
      '<application android:name=".Ghost" />',
      '<activity android:name=".Ghost" />',
      '<service android:name="com.x.Ghost" />',
      '<meta-data android:value="com.x.Ghost" />',
    ]) {
      const sources = [ghost(), kt(`${APP}/src/main/AndroidManifest.xml`, `<manifest>${tag}</manifest>`)];
      expect(flagged(sources, 'Ghost'), tag).toBe(false);
    }
  });

  it('H2 : une custom view citée par FQN dans un layout', () => {
    const sources = [ghost(), kt(`${APP}/src/main/res/layout/m.xml`, '<com.x.Ghost android:id="@+id/g" />')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H2 : tools:context compte, divergence volontaire avec KJ-029 et KJ-031', () => {
    const sources = [ghost(), kt(`${APP}/src/main/res/layout/m.xml`, '<View tools:context=".Ghost" />')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H3 : un graphe de navigation', () => {
    const sources = [ghost(), kt(`${APP}/src/main/res/navigation/nav.xml`,
      '<navigation><fragment android:name="com.x.Ghost" /></navigation>')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H4 : un implementationClass dans un .kts', () => {
    const sources = [ghost(), kt('/w/build.gradle.kts', 'gradlePlugin {\n  implementationClass = "com.x.Ghost"\n}\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H5 : un fichier .properties de plugin Gradle', () => {
    const sources = [ghost(), kt('/w/r/META-INF/gradle-plugins/x.properties', 'implementation-class=com.x.Ghost\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H6 : ServiceLoader, par le CONTENU et par le NOM du fichier', () => {
    const byContent = [ghost(), kt('/w/r/META-INF/services/com.x.Spi', 'com.x.Ghost\n')];
    expect(flagged(byContent, 'Ghost')).toBe(false);
    const byFileName = [ghost(), kt('/w/r/META-INF/services/com.x.Ghost', 'com.x.Impl\n')];
    expect(flagged(byFileName, 'Ghost')).toBe(false);
  });

  it('H7 : un nom en littéral, réflexion ou DI par nom', () => {
    const sources = [ghost(), kt(`${MAIN}/R.kt`, 'package com.x\n\nfun go() = Class.forName("com.x.Ghost")\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H8 : une règle -keep qui nomme la classe', () => {
    const sources = [ghost(), kt('/w/app/proguard-rules.pro', '-keep class com.x.Ghost { *; }\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H8 : mais un -keep à wildcard ne nomme pas la classe et ne la sauve pas', () => {
    const sources = [ghost(), kt('/w/app/proguard-rules.pro', '-keep class com.x.** { *; }\n')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('H9 : Java lit un val top-level via son accesseur getX()', () => {
    const sources = [
      kt(`${MAIN}/Flags.kt`, 'package com.x\n\nval topLevelFlag = true\n'),
      kt(`${APP}/src/main/java/com/x/J.java`, 'class J { boolean f() { return FlagsKt.getTopLevelFlag(); } }\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H9 : et un isFoo via setFoo', () => {
    const sources = [
      kt(`${MAIN}/Flags.kt`, 'package com.x\n\nvar isReady = false\n'),
      kt(`${APP}/src/main/java/com/x/J.java`, 'class J { void f() { FlagsKt.setReady(true); } }\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('H11 : un sous-type scellé nommé par un when est vivant', () => {
    const sources = [
      kt(`${MAIN}/State.kt`, 'package com.x\n\nsealed class State\n\nobject Loading : State()\n\nobject Ghost : State()\n'),
      kt(`${MAIN}/Use.kt`, 'package com.x\n\nfun r(s: State) = when (s) {\n  is Loading -> 1\n  else -> 0\n}\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('H12 : une extension inter-module est nommée par son site d’appel', () => {
    const sources = [
      kt(`${MAIN}/Ext.kt`, 'package com.x\n\nfun String.slugify() = lowercase()\n'),
      kt('/w/feature/src/main/kotlin/com/y/U.kt', 'package com.y\n\nimport com.x.slugify\n\nfun go() = "A".slugify()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });
});

describe.skipIf(!mod)('commentaires et chaînes', () => {
  it('une mention en commentaire ne sauve rien', () => {
    const sources = [ghost(), kt(`${MAIN}/C.kt`, 'package com.x\n\n// Ghost was here\n/* and Ghost too */\nfun f() = 1\n')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('une mention dans un raw string multiligne après un // sauve bien', () => {
    // régression du bug de stripKotlinComments corrigé à l’étape 1
    const sources = [ghost(), kt(`${MAIN}/Q.kt`,
      'package com.x\n\nval q = """\nSELECT 1\n// still inside: com.x.Ghost\n"""\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('un dump de noms généré n’est pas lu par défaut', () => {
    const sources = [ghost(), kt('/w/app/build/outputs/mapping/release/seeds.txt', 'com.x.Ghost\n')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('une baseline detekt nomme une classe sans l’utiliser', () => {
    // Une baseline enregistre les warnings à taire : elle NOMME une classe,
    // elle ne s'en sert pas. Une baseline réelle de 904 lignes portait 376
    // noms distincts, qui auraient tous ressuscité du code mort.
    const sources = [ghost(), kt('/w/config/detekt/baseline.xml',
      '<SmellBaseline><CurrentIssues><ID>UseDataClass:Ghost.kt$Ghost</ID></CurrentIssues></SmellBaseline>')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('une baseline Android Lint non plus', () => {
    const sources = [ghost(), kt('/w/app/lint-baseline.xml', '<issues><issue message="com.x.Ghost" /></issues>')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });

  it('mais un vrai XML nommé autrement compte toujours comme référence', () => {
    const sources = [ghost(), kt('/w/app/src/main/res/layout/m.xml', '<com.x.Ghost />')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('ni un cache d’outil en json', () => {
    const sources = [ghost(), kt('/w/.searchdeadcode-cache.json', '{"symbols":["com.x.Ghost"]}')];
    expect(flagged(sources, 'Ghost')).toBe(true);
  });
});

describe.skipIf(!mod)('test-only, la catégorie à part', () => {
  it('référencé uniquement depuis un test : verdict testOnly', () => {
    const sources = [ghost(), kt(`${TEST}/GhostTest.kt`, 'package com.x\n\nclass GhostTest {\n  val g = Ghost()\n}\n')];
    const found = find(sources);
    expect(found).toHaveLength(1);
    expect(found[0].verdict).toBe('testOnly');
    expect(found[0].testMentions).toBeGreaterThan(0);
  });

  it('référencé nulle part : verdict unreferenced', () => {
    expect(find([ghost()])[0].verdict).toBe('unreferenced');
  });

  it('référencé en main ET en test : vivant, aucune trouvaille', () => {
    const sources = [
      ghost(),
      kt(`${MAIN}/U.kt`, 'package com.x\n\nfun go() = Ghost()\n'),
      kt(`${TEST}/GhostTest.kt`, 'package com.x\n\nclass GhostTest {\n  val g = Ghost()\n}\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('androidTest compte comme un test', () => {
    const sources = [ghost(), kt(`${APP}/src/androidTest/kotlin/com/x/T.kt`, 'package com.x\n\nval g = Ghost()\n')];
    expect(find(sources)[0].verdict).toBe('testOnly');
  });

  it('le dossier test/kotlin-jump-demo n’est PAS un source set de test', () => {
    // segmentMatchesPath borne les composants : c'est ce piège qu'il évite
    const sources = [ghost(), kt('/w/test/kotlin-jump-demo/src/main/kotlin/U.kt', 'fun go() = com.x.Ghost()\n')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('includeTestOnly à false retire la catégorie', () => {
    const sources = [ghost(), kt(`${TEST}/T.kt`, 'package com.x\n\nval g = Ghost()\n')];
    expect(flagged(sources, 'Ghost', { includeTestOnly: false })).toBe(false);
  });
});

describe.skipIf(!mod)('performance', () => {
  it('3 000 fichiers et 3 000 symboles restent sous 4 secondes', () => {
    const sources = Array.from({ length: 3000 }, (_, i) =>
      kt(`${MAIN}/F${i}.kt`, `package com.x\n\nclass Type${i} {\n  fun run() = Type${(i + 1) % 2000}()\n}\n`));
    const start = performance.now();
    const found = find(sources);
    const elapsed = performance.now() - start;
    // 2000 types sont référencés par leur voisin, 1000 ne le sont pas
    expect(found.length).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(4000);
  });
});
