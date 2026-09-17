import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-057 : la constante d un test n est pas l entree de l enum.
 *
 * Sur le projet de reference, `UriScheme.HTTPS` sortait testOnly. Deux tests
 * declaraient `const val HTTPS = "https://..."` dans leur companion et
 * l ecrivaient nue, sans rien importer de l enum. Le detecteur comptait ces
 * mentions nues comme les siennes. L humain a retire l entree : rien ne la
 * nommait.
 *
 * La regle : une mention NUE du nom dans un fichier qui declare lui meme un
 * symbole de ce nom appartient a cette declaration, pas a l entree, a
 * condition que la declaration soit visible de TOUT le fichier : au niveau
 * du fichier, ou membre de la seule classe du fichier (membre du companion,
 * visible de tout le corps ; membre d instance, visible du corps tant qu il
 * n imbrique aucune classe), jamais une locale. Une declaration que le reste
 * du fichier ne voit pas laisse le doute d avant : la resolution contextuelle
 * de Kotlin lie une mention nue a l entree par le type attendu.
 *
 * En Java, l etiquette d un `case` sur l enum est celle de l enum, quoi que
 * le fichier declare (JLS 14.11.1) : un champ `HTTPS` et `case HTTPS:` compilent
 * cote a cote. Un fichier Java qui ecrit le nom en etiquette garde le doute.
 *
 * Sauf si le meme fichier importe aussi l entree, ou toutes celles de l enum,
 * ou en Java par import statique : les deux se disputent le nom, le doute
 * reste et l entree garde son verdict d avant.
 *
 * Une declaration dans un fichier principal suit la meme regle : ses mentions
 * nues ne sont pas un usage de l entree. Et sans declaration homonyme nulle
 * part, rien ne change.
 */

const mod: any = await importOrNull('src/providers/unusedEnumEntries');

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const M = '/w/app/src/main/java';
const T = '/w/app/src/test/java';
const f = (path: string, text: string[]) => ({ path, text: text.join('\n') + '\n' });

const scheme = f(`${M}/com/x/uri/Scheme.kt`, [
  'package com.x.uri',
  '',
  'enum class Scheme(val value: String) {',
  '    HTTP("http"),',
  '    HTTPS("https"),',
  '    LIVE("live"),',
  '    FILE("file")',
  '}',
]);
const open = f(`${M}/com/x/uri/Open.kt`, [
  'package com.x.uri',
  '',
  'fun open(s: String) = when (s) {',
  '    Scheme.HTTP.value -> 1',
  '    Scheme.LIVE.value -> 2',
  '    Scheme.FILE.value -> 3',
  '    else -> 0',
  '}',
]);
const base = () => [scheme, open];

const verdicts = (sources: any[]) =>
  mod.findUnusedEnumEntries({ sources, testSourceSets: TEST_SETS, includeTestOnly: true })
    .map((e: any) => `${e.enumName}.${e.name} ${e.verdict} ${e.testMentions} ${e.testsNameOnlyThisEntry}`);
const outcome = (sources: any[], name: string) =>
  mod.explainEnumEntries({ sources, testSourceSets: TEST_SETS })
    .filter((e: any) => e.name === name).map((e: any) => e.outcome);

/** Le test de reference, en Kotlin : la constante dans le companion, ecrite nue deux fois. */
const kotlinTest = (imports: string[] = []) => f(`${T}/com/x/link/LinkTest.kt`, [
  'package com.x.link',
  '',
  ...imports,
  'import org.junit.Test',
  '',
  'class LinkTest {',
  '    @Test',
  '    fun resolves() {',
  '        val uri = parse(HTTPS)',
  '        check(uri.startsWith(HTTPS))',
  '    }',
  '',
  '    companion object {',
  '        const val HTTPS = "https://example.com/a.html"',
  '    }',
  '}',
]);

/** Le meme en Java : un champ statique du meme nom, ecrit nu une fois. */
const javaTest = (imports: string[] = []) => f(`${T}/com/x/link/LinkTest.java`, [
  'package com.x.link;',
  '',
  ...imports,
  'import org.junit.Test;',
  '',
  'public class LinkTest {',
  '    private static final String HTTPS = "https://example.com/a.html";',
  '',
  '    @Test',
  '    public void resolves() {',
  '        check(parse(HTTPS));',
  '    }',
  '}',
]);

/** Un champ Java du nom, et un switch sur l enum dont un case porte le nom. */
const javaSwitch = (path: string, caseLine: string) => f(path, [
  'package com.x.net;',
  '',
  'import com.x.uri.Scheme;',
  '',
  'public class Handler {',
  '    private static final String HTTPS = "https";',
  '',
  '    String handle(Scheme s) {',
  '        switch (s) {',
  `            ${caseLine}`,
  '            default: return "";',
  '        }',
  '    }',
  '}',
]);

describe.skipIf(!mod)('une mention nue dans un fichier qui declare le nom est celle de sa declaration', () => {
  it('temoin : sans test, l entree est non referencee', () => {
    expect(verdicts(base())).toEqual(['Scheme.HTTPS unreferenced 0 true']);
  });

  it('la constante du companion d un test Kotlin : non referencee, et les tests ne nomment pas QUE cette entree', () => {
    expect(verdicts([...base(), kotlinTest()])).toEqual(['Scheme.HTTPS unreferenced 0 false']);
    expect(outcome([...base(), kotlinTest()], 'HTTPS')).toEqual(['unreferenced']);
  });

  it('le meme test qui importe AUSSI l entree : le doute reste, testOnly comme avant, et le drapeau passe a faux', () => {
    // Le doute ne prouve rien sur les mentions du test, et le plan de retrait
    // des tests, qui cherche par nom, prendrait le test qui a sa propre
    // constante avec lui. Avant cette regle le drapeau disait vrai.
    expect(verdicts([...base(), kotlinTest(['import com.x.uri.Scheme.HTTPS'])])).toEqual(['Scheme.HTTPS testOnly 3 false']);
    expect(verdicts([...base(), kotlinTest(['import com.x.uri.Scheme.*'])])).toEqual(['Scheme.HTTPS testOnly 3 false']);
  });

  it('un champ Java du meme nom : non referencee', () => {
    expect(verdicts([...base(), javaTest()])).toEqual(['Scheme.HTTPS unreferenced 0 false']);
  });

  it('le meme fichier Java qui importe AUSSI l entree en statique : le doute reste, testOnly comme avant', () => {
    expect(verdicts([...base(), javaTest(['import static com.x.uri.Scheme.HTTPS;'])])).toEqual(['Scheme.HTTPS testOnly 2 false']);
    expect(verdicts([...base(), javaTest(['import static com.x.uri.Scheme.*;'])])).toEqual(['Scheme.HTTPS testOnly 2 false']);
  });

  it('un objet ou une fonction du nom dans un test : la meme regle', () => {
    const objet = f(`${T}/com/x/link/ObjetTest.kt`, [
      'package com.x.link',
      '',
      'object HTTPS {',
      '    const val URL = "https://example.com"',
      '}',
      '',
      'fun t() = check(HTTPS.URL.isNotEmpty())',
    ]);
    const fonction = f(`${T}/com/x/link/FonctionTest.kt`, [
      'package com.x.link',
      '',
      'private fun HTTPS(path: String) = "https://example.com/$path"',
      '',
      'fun t() = check(HTTPS("a").isNotEmpty())',
    ]);
    expect(verdicts([...base(), objet])).toEqual(['Scheme.HTTPS unreferenced 0 false']);
    expect(verdicts([...base(), fonction])).toEqual(['Scheme.HTTPS unreferenced 0 false']);
  });
});

describe.skipIf(!mod)('en Java, l etiquette d un case est celle de l enum, quoi que le fichier declare', () => {
  // JLS 14.11.1 : la constante d un case, sur un switch dont le sujet est
  // l enum, est le nom simple d une de ses entrees, resolu par le type du
  // sujet et non par la portee du fichier. Le champ et l etiquette compilent
  // cote a cote, et l etiquette n a besoin d aucun import. Le fichier garde
  // donc le doute d avant : retirer l entree casserait le switch.
  it('un champ du nom et `case HTTPS:` dans un fichier principal : vivante', () => {
    const j = javaSwitch(`${M}/com/x/net/Handler.java`, 'case HTTPS: return HTTPS + "://";');
    expect(verdicts([...base(), j])).toEqual([]);
    expect(outcome([...base(), j], 'HTTPS')).toEqual(['alive:main']);
  });

  it('le meme dans un test : testOnly, avec le compte d avant', () => {
    const j = javaSwitch(`${T}/com/x/net/HandlerTest.java`, 'case HTTPS: return HTTPS;');
    expect(verdicts([...base(), j])).toEqual(['Scheme.HTTPS testOnly 3 true']);
  });

  it('la forme fleche a plusieurs etiquettes, `case HTTP, HTTPS ->` : vivante', () => {
    const j = f(`${M}/com/x/net/Labels.java`, [
      'package com.x.net;',
      '',
      'import com.x.uri.Scheme;',
      '',
      'public class Labels {',
      '    private static final String HTTPS = "https";',
      '',
      '    int f(Scheme s) {',
      '        return switch (s) {',
      '            case HTTP, HTTPS -> 1;',
      '            default -> 0;',
      '        };',
      '    }',
      '}',
    ]);
    expect(verdicts([...base(), j])).toEqual([]);
    expect(outcome([...base(), j], 'HTTPS')).toEqual(['alive:main']);
  });

  it('une locale `var HTTPS` de Java 10 dans la methode du switch : vivante', () => {
    const j = f(`${M}/com/x/net/H.java`, [
      'package com.x.net;',
      '',
      'import com.x.uri.Scheme;',
      '',
      'public class H {',
      '    String handle(Scheme s) {',
      '        var HTTPS = "x";',
      '        switch (s) { case HTTPS: return HTTPS; default: return ""; }',
      '    }',
      '}',
    ]);
    expect(verdicts([...base(), j])).toEqual([]);
  });

  it('des constantes de colonne a cote d un switch sur l enum : seule l entree que rien ne nomme sort', () => {
    // La forme ordinaire d un DAO Android : `DATE` et `TIME` sont a la fois
    // des noms de colonne et des entrees de l enum de tri.
    const crit = f(`${M}/com/x/log/Criteria.java`, [
      'package com.x.log;',
      '',
      'public class Criteria {',
      '    public enum SortValue { DATE, TIME, LEVEL }',
      '    private SortValue sortValue;',
      '    public SortValue getSortValue() { return sortValue; }',
      '}',
    ]);
    const dao = f(`${M}/com/x/log/LogDao.java`, [
      'package com.x.log;',
      '',
      'public class LogDao {',
      '    private static final String DATE = "date";',
      '    private static final String TIME = "time";',
      '',
      '    String orderBy(Criteria c) {',
      '        switch (c.getSortValue()) {',
      '            case DATE -> { return DATE; }',
      '            case TIME -> { return TIME; }',
      '            default -> { return "level"; }',
      '        }',
      '    }',
      '}',
    ]);
    expect(verdicts([crit, dao])).toEqual(['SortValue.LEVEL unreferenced 0 true']);
  });
});

describe.skipIf(!mod)('la declaration doit etre visible de tout le fichier', () => {
  it('la constante du companion d une classe, ecrite nue dans l AUTRE classe du fichier : doute, vivante', () => {
    // A.Companion n est pas dans la portee de B : la branche du `when` est
    // l entree, liee par le type attendu. Avant cette regle, le fichier entier
    // passait pour celui de la constante.
    const deux = f(`${M}/com/x/net/Two.kt`, [
      'package com.x.net',
      '',
      'import com.x.uri.Scheme',
      '',
      'class A {',
      '    companion object {',
      '        const val HTTPS = "https"',
      '    }',
      '}',
      '',
      'class B {',
      '    fun label(s: Scheme) = when (s) {',
      '        HTTPS -> 1',
      '        else -> 0',
      '    }',
      '}',
    ]);
    expect(verdicts([...base(), deux])).toEqual([]);
    expect(outcome([...base(), deux], 'HTTPS')).toEqual(['alive:main']);
  });

  it('une declaration au niveau du fichier, ecrite nue dans une classe du fichier : la sienne', () => {
    const haut = f(`${M}/com/x/net/Top.kt`, [
      'package com.x.net',
      '',
      'import com.x.uri.Scheme',
      '',
      'private const val HTTPS = "https"',
      '',
      'class B {',
      '    fun label(s: Scheme) = s.value == HTTPS',
      '}',
    ]);
    expect(verdicts([...base(), haut])).toEqual(['Scheme.HTTPS unreferenced 0 true']);
  });

  it('un membre d instance de la seule classe du fichier : le sien', () => {
    const membre = f(`${M}/com/x/net/Link.kt`, [
      'package com.x.net',
      '',
      'import com.x.uri.Scheme',
      '',
      'class Link {',
      '    private val HTTPS = "https"',
      '',
      '    fun label(s: Scheme) = s.value == HTTPS',
      '}',
    ]);
    expect(verdicts([...base(), membre])).toEqual(['Scheme.HTTPS unreferenced 0 true']);
  });

  it('le meme membre d instance, mais la classe imbrique une classe qui l ecrit nue : doute', () => {
    // Une classe imbriquee ne voit pas les membres d instance de la classe
    // qui l entoure. Un objet imbrique qui n est pas le companion demande
    // son nom devant les siens : `Keys.HTTPS`, jamais `HTTPS` nu.
    const imbriquee = f(`${M}/com/x/net/Link.kt`, [
      'package com.x.net',
      '',
      'import com.x.uri.Scheme',
      '',
      'class Link {',
      '    private val HTTPS = "https"',
      '',
      '    class Nested {',
      '        fun label(s: Scheme) = when (s) {',
      '            HTTPS -> 1',
      '            else -> 0',
      '        }',
      '    }',
      '}',
    ]);
    const objet = f(`${M}/com/x/net/Link.kt`, [
      'package com.x.net',
      '',
      'import com.x.uri.Scheme',
      '',
      'class Link {',
      '    object Keys {',
      '        const val HTTPS = "https"',
      '    }',
      '',
      '    fun label(s: Scheme) = when (s) {',
      '        HTTPS -> 1',
      '        else -> 0',
      '    }',
      '}',
    ]);
    expect(verdicts([...base(), imbriquee])).toEqual([]);
    expect(outcome([...base(), imbriquee], 'HTTPS')).toEqual(['alive:main']);
    expect(verdicts([...base(), objet])).toEqual([]);
  });

  it('la constante du companion, ecrite nue dans une classe imbriquee : la sienne', () => {
    // Le companion, lui, est visible de tout le corps, classes imbriquees
    // comprises.
    const companion = f(`${M}/com/x/net/Link.kt`, [
      'package com.x.net',
      '',
      'class Link {',
      '    class Nested {',
      '        fun open() = parse(HTTPS)',
      '    }',
      '',
      '    companion object {',
      '        const val HTTPS = "https://example.com"',
      '    }',
      '}',
    ]);
    expect(verdicts([...base(), companion])).toEqual(['Scheme.HTTPS unreferenced 0 true']);
  });
});

describe.skipIf(!mod)('une declaration dans le code principal n est pas un usage de l entree', () => {
  const locale = f(`${M}/com/x/net/Open.kt`, [
    'package com.x.net',
    '',
    'fun open(): String {',
    '    val HTTPS = "https"',
    '    return HTTPS',
    '}',
  ]);

  it('un val local du meme nom : personne d autre ne le voit, le doute reste, vivante', () => {
    expect(verdicts([...base(), locale])).toEqual([]);
    expect(outcome([...base(), locale], 'HTTPS')).toEqual(['alive:main']);
  });

  it('le meme val au niveau du fichier : l entree reste non referencee', () => {
    const haut = f(`${M}/com/x/net/Open.kt`, [
      'package com.x.net',
      '',
      'private val HTTPS = "https"',
      '',
      'fun open(): String = HTTPS',
    ]);
    expect(verdicts([...base(), haut])).toEqual(['Scheme.HTTPS unreferenced 0 true']);
    expect(outcome([...base(), haut], 'HTTPS')).toEqual(['unreferenced']);
  });

  it('temoin : la meme mention nue sans declaration passe pour un usage, comme avant', () => {
    const nue = { ...locale, text: locale.text.replace('    val HTTPS = "https"\n', '') };
    expect(verdicts([...base(), nue])).toEqual([]);
    expect(outcome([...base(), nue], 'HTTPS')).toEqual(['alive:main']);
  });
});

describe.skipIf(!mod)('sans declaration homonyme, rien ne change', () => {
  it('un test qui ecrit le nom nu sans le declarer ni l importer : testOnly, comme avant', () => {
    const nu = f(`${T}/com/x/link/NuTest.kt`, [
      'package com.x.link',
      '',
      'fun t() = check(parse(HTTPS) != null && HTTPS.isNotEmpty())',
    ]);
    expect(verdicts([...base(), nu])).toEqual(['Scheme.HTTPS testOnly 2 true']);
  });

  it('un test qui importe l entree : testOnly, comme avant', () => {
    const importe = f(`${T}/com/x/link/ImporteTest.kt`, [
      'package com.x.link',
      '',
      'import com.x.uri.Scheme.HTTPS',
      '',
      'fun t() = check(HTTPS.value == "https")',
    ]);
    expect(verdicts([...base(), importe])).toEqual(['Scheme.HTTPS testOnly 1 true']);
  });

  it('un test qui la nomme qualifiee, un autre qui a sa propre constante : testOnly, mais pas QUE cette entree', () => {
    // Le plan de retrait des tests cherche par nom : il prendrait le test qui a
    // sa propre constante avec lui. Le drapeau le dit.
    const qualifie = f(`${T}/com/x/uri/SchemeTest.kt`, [
      'package com.x.uri',
      '',
      'fun t() = check(Scheme.HTTPS.value == "https")',
    ]);
    expect(verdicts([...base(), qualifie, kotlinTest()])).toEqual(['Scheme.HTTPS testOnly 1 false']);
    expect(verdicts([...base(), qualifie])).toEqual(['Scheme.HTTPS testOnly 1 true']);
  });

  it('l entree d un enum Java sur une ligne n est pas sa propre ombre', () => {
    // `enum Kind { A, B; }` se lit comme un champ Java nomme B. Pris pour une
    // declaration etrangere, le doute laissait le drapeau a faux.
    const kind = f(`${M}/com/x/kind/Kind.java`, [
      'package com.x.kind;',
      '',
      'public enum Kind { A, B; }',
    ]);
    const use = f(`${M}/com/x/kind/Use.java`, [
      'package com.x.kind;',
      '',
      'class Use { Kind a() { return Kind.A; } }',
    ]);
    const test = f(`${T}/com/x/kind/KindTest.java`, [
      'package com.x.kind;',
      '',
      'import static com.x.kind.Kind.B;',
      '',
      'class KindTest { void t() { check(B); } }',
    ]);
    expect(verdicts([kind, use, test])).toEqual(['Kind.B testOnly 1 true']);
  });
});
