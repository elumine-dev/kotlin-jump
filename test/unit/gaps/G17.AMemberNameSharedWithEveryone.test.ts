import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G17 — un membre dont le nom est partage n est jamais juge mort.
 *
 * Voir doc/gaps-detection.md. Troisieme etage du motif de G15 et G16, et le
 * plus large des trois en volume.
 *
 * ## Les chiffres du corpus de reference
 *
 *   methodes membres declarees        22 044
 *   noms de methode distincts         11 718
 *   noms portes par 2 classes ou plus  2 749
 *   declarations concernees           13 075  soit 59 %
 *
 * Les noms les plus partages disent pourquoi : `inject` 824 declarations,
 * `setUp` 354, `onBusEvent` 288, `toString` 190, `bind` 140, `onCreate` 114.
 *
 * Et le resultat se lit dans ce que le detecteur rend : sur 22 044 membres,
 * **211 trouvailles, dont 2 seulement en `unreferenced`**. Les 209 autres
 * sont `selfOnly` ou `testOnly`, deux voies qui n ont pas besoin de resoudre
 * les homonymes puisqu elles raisonnent sur l endroit d ou vient la mention,
 * pas sur son nom.
 *
 * ## Le mecanisme, mesure en isolant
 *
 * Une classe avec une methode morte au nom commun, puis le meme corpus avec
 * un homonyme :
 *
 *   build() morte, sans homonyme                  -> rapportee
 *   + OtherBuilder.build(), classe DU CORPUS      -> perdue
 *   + Request.Builder().build(), BIBLIOTHEQUE     -> perdue
 *   + un appel sur une variable non typee         -> perdue
 *
 * La deuxieme ligne est ce qui distingue G17 de G15. Pour les entrees
 * d enum, la resolution par enum du corpus fonctionne : deux enums lisibles
 * sont correctement separes. Ici, **meme un homonyme parfaitement lisible
 * masque** : `OtherBuilder` est declaree dans le corpus, son `build()` est
 * appele sur une instance de `OtherBuilder`, et pourtant `Builder.build()`
 * disparait. Il n y a aucune resolution par conteneur.
 *
 * ## Ce que les tests demandent
 *
 * Le detecteur connait deja le conteneur de chaque membre, il le rend dans
 * le champ `container`. Ce qui manque est de s en servir au moment de
 * compter : un appel `OtherBuilder().build()` nomme son recepteur, et un
 * appel sur une variable declaree `val b: Builder` aussi.
 *
 * Les gardes disent la contrepartie, et elle est severe : une methode
 * appelee sur une variable dont le type n est pas lisible doit rester
 * vivante. Couper un membre appele quelque part casse la compilation, ce qui
 * est le seul endroit de ce dossier ou une erreur se voit tout de suite.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const membres = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedMembers({
    sources, testSourceSets: ['/src/test/'], includeSelfOnly: false,
  }) as any[]);

const noms = (...sources: { path: string; text: string }[]) =>
  membres(...sources).map(m => `${m.container}.${m.name}`);

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Une classe avec deux methodes mortes : l une au nom tres commun, l autre
 * au nom unique. La seconde est le canari, elle doit toujours ressortir.
 */
const CLASSE = f(`${MAIN}/Builder.kt`, [
  'package com.x',
  '',
  'class Builder {',
  '    fun build(): String = "x"',
  '    fun neverCalledUniqueName(): Int = 1',
  '}',
  '',
  'fun keep(b: Builder) = b',
  '',
].join('\n'));

const epargne = (trouves: string[], cible: string) => {
  expect(trouves).toContain('Builder.neverCalledUniqueName');
  expect(trouves).not.toContain(cible);
};

describe.skipIf(!mod)('G17 — le corpus de test est lisible', () => {
  it('rapporte les deux methodes mortes quand rien ne les masque', () => {
    expect(noms(CLASSE)).toEqual(
      expect.arrayContaining(['Builder.build', 'Builder.neverCalledUniqueName']));
  });

  /**
   * SENTINELLE. Elle fixe les trois formes de masquage. La premiere est la
   * plus importante : contrairement a G15, un homonyme DU CORPUS masque ici.
   * Si cette ligne se met a echouer, une resolution par conteneur est
   * apparue et G17 doit etre relu.
   */
  it('aujourd hui, trois formes d homonyme masquent le membre', () => {
    const duCorpus = f(`${MAIN}/Other.kt`, [
      'package com.x',
      '',
      'class OtherBuilder {',
      '    fun build(): Int = 2',
      '}',
      '',
      'fun use() = OtherBuilder().build()',
      '',
    ].join('\n'));
    const deBibliotheque = f(`${MAIN}/Http.kt`, [
      'package com.x',
      '',
      'import okhttp3.Request',
      '',
      'fun req() = Request.Builder().url("x").build()',
      '',
    ].join('\n'));
    const nonType = f(`${MAIN}/Loose.kt`, [
      'package com.x',
      '',
      'fun other(x: Any) = x.toString().build()',
      '',
    ].join('\n'));

    for (const masque of [duCorpus, deBibliotheque, nonType]) {
      const sortis = noms(CLASSE, masque);
      expect(sortis).toContain('Builder.neverCalledUniqueName');
      expect(sortis).not.toContain('Builder.build');
    }
  });
});

describe.skipIf(!mod)('G17 — le membre que son propre nom fait disparaitre', () => {
  it.fails('rapporte build() malgre un homonyme declare dans le corpus', () => {
    // Le cas le plus net : les DEUX conteneurs sont lisibles, et l appel
    // nomme son recepteur. Rien n empeche de les distinguer.
    const duCorpus = f(`${MAIN}/Other.kt`, [
      'package com.x',
      '',
      'class OtherBuilder {',
      '    fun build(): Int = 2',
      '}',
      '',
      'fun use() = OtherBuilder().build()',
      '',
    ].join('\n'));
    expect(noms(CLASSE, duCorpus)).toContain('Builder.build');
  });

  it.fails('rapporte build() malgre un appel sur un type de bibliotheque', () => {
    const deBibliotheque = f(`${MAIN}/Http.kt`, [
      'package com.x',
      '',
      'import okhttp3.Request',
      '',
      'fun req() = Request.Builder().url("x").build()',
      '',
    ].join('\n'));
    expect(noms(CLASSE, deBibliotheque)).toContain('Builder.build');
  });

  it.fails('rapporte une methode au nom tres partage du corpus', () => {
    // `onBusEvent` : 288 declarations sur le corpus de reference. Une de plus
    // ou une de moins ne change rien au fait que celle ci est morte.
    const abonne = f(`${MAIN}/Listener.kt`, [
      'package com.x',
      '',
      'class Listener {',
      '    fun onBusEvent(e: SomeEvent) = Unit',
      '}',
      '',
      'fun keepListener(l: Listener) = l',
      '',
    ].join('\n'));
    const autre = f(`${MAIN}/OtherListener.kt`, [
      'package com.x',
      '',
      'class OtherListener {',
      '    fun onBusEvent(e: OtherEvent) = Unit',
      '}',
      '',
      'fun wire(o: OtherListener) = o.onBusEvent(OtherEvent())',
      '',
    ].join('\n'));
    expect(noms(abonne, autre)).toContain('Listener.onBusEvent');
  });

  it.fails('rapporte une propriete masquee de la meme facon', () => {
    // Le trou ne concerne pas que les methodes.
    const avecProp = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder {',
      '    val size: Int = 0',
      '}',
      '',
      'fun keepHolder(h: Holder) = h',
      '',
    ].join('\n'));
    const ailleurs = f(`${MAIN}/User.kt`, [
      'package com.x',
      '',
      'fun count(l: List<String>) = l.size',
      '',
    ].join('\n'));
    expect(noms(avecProp, ailleurs)).toContain('Holder.size');
  });
});

describe.skipIf(!mod)('G17 — les gardes, qui passent des maintenant', () => {
  /**
   * La contrepartie est severe : couper un membre appele quelque part casse
   * la compilation. C est le seul endroit de ce dossier ou une erreur se voit
   * immediatement, donc ces gardes comptent plus que les cas positifs.
   */

  it('ne touche pas une methode appelee sur une variable de son type', () => {
    const appelant = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go(b: Builder) = b.build()',
      '',
    ].join('\n'));
    epargne(noms(CLASSE, appelant), 'Builder.build');
  });

  it('ne touche pas une methode appelee sur une instance construite sur place', () => {
    const appelant = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go() = Builder().build()',
      '',
    ].join('\n'));
    epargne(noms(CLASSE, appelant), 'Builder.build');
  });

  it('ne touche pas une methode appelee via une variable non typee', () => {
    // Le type du recepteur n est pas lisible : le detecteur ne peut pas
    // prouver que l appel ne vise pas `Builder`, donc il doit se taire.
    const appelant = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go(anything: Any) = (anything as Builder).build()',
      '',
    ].join('\n'));
    epargne(noms(CLASSE, appelant), 'Builder.build');
  });

  /**
   * « JAMAIS NOMMEE » N EST PAS « MORTE », et c est la lecon la plus chere de
   * ce fichier.
   *
   * En estimant l ampleur de G17, une premiere sonde a compte comme morte
   * toute methode dont le nom n apparait nulle part ailleurs. Elle a rendu
   * 31,6 % de mortalite et une extrapolation a 4134 membres. Faux : ses
   * premiers exemples etaient `providePersistence`,
   * `provideAdKitDownloaderRepository`, `provideNGAdViewActionListenerDelegate`,
   * toutes des fournitures Dagger bien vivantes que le code genere appelle
   * sans jamais ecrire leur nom.
   *
   * En ecartant les methodes annotees, les `override` et les rappels de cycle
   * de vie, le taux tombe a 1,68 % et l estimation a une soixantaine de
   * membres. C est cet ordre de grandeur qui est juste.
   *
   * Ce test fixe la distinction : une fourniture n est nommee nulle part et
   * ne doit jamais etre rapportee par cette famille.
   */
  it('ne touche pas une fourniture Dagger, jamais nommee et pourtant vivante', () => {
    const module = f(`${MAIN}/AdKitProviderModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class AdKitProviderModule {',
      '',
      '    @Provides',
      '    fun providePersistence(context: Context): Persistence =',
      '        SharedPreferencesPersistence(context)',
      '}',
      '',
      'fun keepModule(m: AdKitProviderModule) = m',
      '',
    ].join('\n'));
    expect(noms(module)).not.toContain('AdKitProviderModule.providePersistence');
  });

  it('ne touche pas une methode appelee depuis sa propre classe', () => {
    // C est le verdict `selfOnly`, qui fonctionne deja et qui represente 169
    // des 211 trouvailles du corpus. Il ne doit pas devenir `unreferenced`.
    const interne = f(`${MAIN}/SelfUser.kt`, [
      'package com.x',
      '',
      'class SelfUser {',
      '    private fun helper(): Int = 1',
      '    fun api(): Int = helper()',
      '}',
      '',
      'fun keepSelf(s: SelfUser) = s.api()',
      '',
    ].join('\n'));
    expect(noms(interne)).not.toContain('SelfUser.helper');
  });

  it('ne touche pas une methode que seul un test appelle', () => {
    const test = f('/w/app/src/test/java/com/x/BuilderTest.kt', [
      'package com.x',
      '',
      'class BuilderTest {',
      '    fun check(b: Builder) = b.build()',
      '}',
      '',
    ].join('\n'));
    const trouve = membres(CLASSE, test).find(m => m.name === 'build');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(mod.findUnusedMembers({
      sources: [CLASSE], testSourceSets: ['/src/test/'], truncated: true,
    })).toHaveLength(0);
  });
});
