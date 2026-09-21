import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G39 — un porteur que personne ne lance.
 *
 * Derniere famille du recensement : `RemoveTestOnlyCode`. Elle prend les
 * declarations au verdict `testOnly` et propose de les retirer AVEC les tests
 * qui les nomment.
 *
 *   symboles rapportes avec `includeTestOnly` : 33 `unreferenced`, 15 `testOnly`
 *   membres                                   : 40 `testOnly`
 *
 * ## Ce que `testOnly` prouve, et ce qu il ne prouve pas
 *
 * Il prouve qu aucune source de PRODUCTION ne nomme la declaration, et qu au
 * moins une source de test la nomme. Il ne demande pas si ce citant de test
 * est lui meme atteint.
 *
 * La difference se voit sur quatre corpus qui ne different que par leur
 * porteur :
 *
 *   rien ne la nomme                                    -> unreferenced
 *   une classe de test la nomme                         -> testOnly
 *   un utilitaire de test, nomme par un test, la nomme  -> testOnly
 *   un utilitaire de test que RIEN ne nomme, la nomme   -> testOnly
 *
 * La quatriere ligne est le trou. Une classe `FooTest` est lancee par le
 * coureur de tests sans que personne la nomme : elle est un point d entree, et
 * `testOnly` est juste. Un `object TestUtils` que pas un test ne nomme n est
 * lance par personne : la declaration qu il tient n est exercee par aucun
 * test, et elle est simplement morte.
 *
 * La consequence n est pas seulement une etiquette. `RemoveTestOnlyCode`
 * retire la declaration et ses tests ; un utilitaire orphelin qui reste en
 * place se met a nommer un symbole disparu.
 *
 * ## Ce que ca coute sur le corpus
 *
 * **Zero.** Les quinze `testOnly` sont tous tenus par de vraies classes de
 * test. Cinquieme recensement de suite sans recolte, et c est le resultat :
 * les gardes de cette famille tiennent.
 *
 * Le fichier reste utile comme filet : la difference entre un porteur lance et
 * un porteur orphelin n est ecrite nulle part aujourd hui.
 *
 * ## Le tour des onze familles, clos
 *
 *   unusedSymbols     G20, G21, G24, G25, G26, G27, G28
 *   unusedMembers     G23, G29, G30, G31, G38
 *   unusedResources   G32
 *   scanEnums         G33
 *   deadIslands       G34
 *   remoteConfig      G35
 *   writeOnlyKeys     G37
 *   unheardEvents     G37
 *   gradleDeps        G35, rien a signaler
 *   selfOnlyPrivate   G38
 *   testOnlyCode      G39
 *
 * Deux defauts seulement se repetent : « une declaration non jugee sert de
 * preuve » (G21, G22, G27, G29, G34, G38) et « `explain` et `find` ne disent
 * pas la meme chose » (G28, G35, G36).
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const TEST = '/w/app/src/test/java/com/x';
const f = (chemin: string, texte: string) => ({ path: chemin, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'], includeTestOnly: true } as any);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols(base(sources)) as any[]).find(s => s.name === nom);

const rapportes = (...sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols(base(sources)) as any[]).map(s => `${s.name}:${s.verdict}`);

// ── Les quatre corpus, qui ne different que par leur porteur ───────────────

/** La declaration de production, la meme partout. */
const PRODUCTION = f(`${MAIN}/Helper.kt`, [
  'package com.x',
  '',
  'class Helper {',
  '',
  '    fun go() = 1',
  '}',
  '',
].join('\n'));

/** Une classe de test : le coureur la lance sans que personne la nomme. */
const CLASSE_DE_TEST = f(`${TEST}/HelperTest.kt`, [
  'package com.x',
  '',
  'class HelperTest {',
  '',
  '    @Test',
  '    fun t() = Helper().go()',
  '}',
  '',
].join('\n'));

/** Un utilitaire de test : personne ne le lance, il faut qu on le nomme. */
const UTILITAIRE = f(`${TEST}/TestUtils.kt`, [
  'package com.x',
  '',
  'object TestUtils {',
  '',
  '    fun build() = Helper()',
  '}',
  '',
].join('\n'));

/** Le test qui utilise l utilitaire : la chaine est alors complete. */
const TEST_QUI_UTILISE = f(`${TEST}/HelperTest.kt`, [
  'package com.x',
  '',
  'class HelperTest {',
  '',
  '    @Test',
  '    fun t() = TestUtils.build()',
  '}',
  '',
].join('\n'));

const VIVANT = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!symb)('les trois premiers corpus sont juges correctement', () => {
  it('sans aucun porteur, la declaration est morte', () => {
    expect(verdict('Helper', PRODUCTION, VIVANT)).toMatchObject({ outcome: 'unreferenced' });
    expect(rapportes(PRODUCTION, VIVANT)).toContain('Helper:unreferenced');
  });

  it('avec une classe de test, elle est testOnly', () => {
    expect(verdict('Helper', PRODUCTION, CLASSE_DE_TEST, VIVANT)).toMatchObject({ outcome: 'testOnly' });
  });

  it('avec un utilitaire qu un test utilise, elle est testOnly aussi', () => {
    expect(verdict('Helper', PRODUCTION, UTILITAIRE, TEST_QUI_UTILISE, VIVANT))
      .toMatchObject({ outcome: 'testOnly' });
  });
});

// ── Sentinelle : le quatrieme corpus ───────────────────────────────────────

describe.skipIf(!symb)('aujourd hui, un porteur orphelin vaut un porteur lance', () => {
  /**
   * Le meme verdict que dans les deux cas legitimes, alors que rien ne lance
   * `TestUtils` : la declaration n est exercee par AUCUN test.
   */
  it('un utilitaire que rien ne nomme rend quand meme la declaration testOnly', () => {
    expect(verdict('Helper', PRODUCTION, UTILITAIRE, VIVANT)).toMatchObject({ outcome: 'testOnly' });
  });

  it('exactement comme une vraie classe de test', () => {
    const avecUtilitaire = verdict('Helper', PRODUCTION, UTILITAIRE, VIVANT);
    const avecTest = verdict('Helper', PRODUCTION, CLASSE_DE_TEST, VIVANT);
    expect(avecUtilitaire.outcome).toBe(avecTest.outcome);
  });

  /**
   * Et l utilitaire orphelin lui meme n est pas rapporte : il resterait en
   * place, a nommer un symbole que la commande vient de retirer.
   */
  it('et l utilitaire orphelin n est pas rapporte', () => {
    expect(rapportes(PRODUCTION, UTILITAIRE, VIVANT).join(' ')).not.toContain('TestUtils');
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!symb)('un porteur que personne ne lance ne prouve rien', () => {
  it.fails('la declaration devrait etre morte, pas testOnly', () => {
    expect(verdict('Helper', PRODUCTION, UTILITAIRE, VIVANT)).toMatchObject({ outcome: 'unreferenced' });
  });

  it.fails('et le verdict devrait differer de celui d une vraie classe de test', () => {
    const avecUtilitaire = verdict('Helper', PRODUCTION, UTILITAIRE, VIVANT);
    const avecTest = verdict('Helper', PRODUCTION, CLASSE_DE_TEST, VIVANT);
    expect(avecUtilitaire.outcome).not.toBe(avecTest.outcome);
  });

  /**
   * Et l utilitaire orphelin devrait etre rapporte, sans quoi la commande
   * retire `Helper` et laisse `TestUtils` nommer un symbole disparu.
   */
  it.fails('l utilitaire orphelin devrait etre rapporte lui aussi', () => {
    expect(rapportes(PRODUCTION, UTILITAIRE, VIVANT).join(' ')).toContain('TestUtils');
  });
});

// ── Gardes : les porteurs qui portent vraiment ─────────────────────────────

describe.skipIf(!symb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(verdict('Helper', PRODUCTION, VIVANT))
    .toMatchObject({ outcome: 'unreferenced' });

  /**
   * Une classe dont le nom finit par `Test` est lancee par le coureur sans que
   * personne la nomme. C est un point d entree, et `testOnly` y est juste.
   */
  it('une classe de test, que le coureur lance', () => {
    temoin();
    expect(verdict('Helper', PRODUCTION, CLASSE_DE_TEST, VIVANT)).toMatchObject({ outcome: 'testOnly' });
  });

  it('un utilitaire de test qu une classe de test nomme', () => {
    temoin();
    expect(verdict('Helper', PRODUCTION, UTILITAIRE, TEST_QUI_UTILISE, VIVANT))
      .toMatchObject({ outcome: 'testOnly' });
  });

  /**
   * Une classe de base de test, nommee par personne mais dont un test herite :
   * la chaine passe par la clause d heritage, pas par un appel.
   */
  it('une classe de base dont un test herite', () => {
    temoin();
    const socle = f(`${TEST}/BaseTest.kt`, [
      'package com.x',
      '',
      'open class BaseTest {',
      '',
      '    fun setUp() = Helper()',
      '}',
      '',
    ].join('\n'));
    const enfant = f(`${TEST}/HelperTest.kt`, [
      'package com.x',
      '',
      'class HelperTest : BaseTest() {',
      '',
      '    @Test',
      '    fun t() = setUp()',
      '}',
      '',
    ].join('\n'));
    expect(verdict('Helper', PRODUCTION, socle, enfant, VIVANT)).toMatchObject({ outcome: 'testOnly' });
  });

  /**
   * Et surtout : un utilisateur de PRODUCTION rend la declaration vivante. La
   * relache ne doit jamais transformer un `alive` en trouvaille.
   */
  it('un utilisateur de production la garde vivante', () => {
    temoin();
    const usage = f(`${MAIN}/Usage.kt`, 'package com.x\n\nfun go() = Helper().go()\n');
    const appel = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    go()\n}\n');
    expect(verdict('Helper', PRODUCTION, UTILITAIRE, usage, appel)).toMatchObject({ outcome: 'alive:main' });
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    temoin();
    expect(symb.findUnusedSymbols({ ...base([PRODUCTION, UTILITAIRE, VIVANT]), truncated: true }))
      .toHaveLength(0);
  });
});
