import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G10 — un sous type scelle imbrique n est jamais juge.
 *
 * Voir doc/gaps-detection.md. C est le pendant de KJ-066, qui emporte un enum
 * dont toutes les entrees meurent, pour les classes scellees.
 *
 * ## Mesure honnete : zero trouvaille sur le corpus de reference
 *
 * 108 familles scellees avec des sous types lisibles, et pas un seul sous
 * type que rien ne nomme ailleurs. J ai verifie a la main les cinq de
 * `FeedScrollState`
 * `ScrollDown`, `ScrollUp`, `ScrollIdle`, `ScrolledDown` et `ScrolledTop` sont
 * tous utilises. La fixture ci dessous reprend donc la FORME de ce fichier,
 * pas un cas mort qui n existe pas.
 *
 * ## Mais la forme n est pas couverte, et ca se mesure
 *
 * Deux corpus minimaux qui ne different que par la PLACE du sous type :
 *
 *   object NeverUsed : State()    imbrique dans le corps   -> jamais candidat
 *   object NeverBuilt : Result()  frere, premier niveau    -> unreferenced, rapporte
 *   object NeverBuilt             ordinaire, sans parent   -> unreferenced, rapporte
 *
 * Le sous type imbrique n est juge ni par `findUnusedSymbols`, qui ne descend
 * pas sous le niveau zero, ni par `findUnusedMembers`, pour qui une classe
 * imbriquee n est pas un membre. Personne ne le regarde.
 *
 * Or la forme imbriquee est la plus courante en Kotlin : c est celle
 * qu ecrivent `NavigationEvents` et `:259`.
 *
 * ## Pourquoi ecrire ces tests malgre le zero
 *
 * Meme profil que G6. Une branche scellee ne meurt pas toute seule : elle
 * meurt quand le dernier `when` qui la traite perd sa raison d etre. C est
 * une trouvaille de ronde suivante, et un detecteur qui ne regarde jamais la
 * forme ne la verra pas plus au tour dix qu au tour un. Les cas « ronde
 * deux » ci dessous donnent le corpus tel que la boucle le verrait une fois
 * le consommateur coupe.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const mod = symb && memb ? { symb, memb } : null;

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  symb.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const membres = (...sources: { path: string; text: string }[]) =>
  memb.findUnusedMembers({
    sources, testSourceSets: ['/src/test/'], includeSelfOnly: false,
  }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

/** Le canari : un object de premier niveau mort, juge des aujourd hui. */
const CANARI = f(`${MAIN}/CanaryGone.kt`, [
  'package com.x',
  '',
  'object CanaryGone',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures, sur la forme de NavigationEvents ───────────────────────

/** Une branche imbriquee que le `when` ne traite pas et que rien ne construit. */
const IMBRIQUE = f(`${MAIN}/FeedScrollState.kt`, [
  'package com.x',
  '',
  'sealed class FeedScrollState {',
  '    data object ScrollDown : FeedScrollState()',
  '    data object ScrollUp : FeedScrollState()',
  '    data object ScrolledTop : FeedScrollState()',
  '}',
  '',
  'fun label(state: FeedScrollState) = when (state) {',
  '    is FeedScrollState.ScrollDown -> "down"',
  '    is FeedScrollState.ScrollUp -> "up"',
  '    else -> ""',
  '}',
  '',
].join('\n'));

/** La meme famille, mais a plat : le detecteur la juge deja. */
const A_PLAT = f(`${MAIN}/Result.kt`, [
  'package com.x',
  '',
  'sealed class Result',
  '',
  'object Ok : Result()',
  '',
  'object NeverBuilt : Result()',
  '',
  'fun use(r: Result) = r',
  '',
].join('\n'));

describe.skipIf(!mod)('G10 — le corpus de test est lisible', () => {
  it('rapporte un sous type de PREMIER NIVEAU que rien ne construit', () => {
    expect(nomme(symboles(A_PLAT), 'NeverBuilt')).toBe(true);
  });

  it('rapporte un object ordinaire que rien ne nomme', () => {
    expect(nomme(symboles(CANARI), 'CanaryGone')).toBe(true);
  });

  /**
   * SENTINELLE. Meme famille scellee, meme branche morte, et seule la PLACE
   * change. C est la demonstration que le trou est l imbrication et rien
   * d autre. Si ce test se met a echouer, la profondeur exploree a change et
   * l entree G10 du document doit etre relue.
   */
  it('aujourd hui, seule la place du sous type decide qu il soit juge', () => {
    expect(pourquoi('NeverBuilt', A_PLAT))
      .toMatchObject({ kind: 'object', outcome: 'unreferenced' });
    expect(pourquoi('ScrolledTop', IMBRIQUE)).toBeUndefined();
    // Ni symbole, ni membre : personne ne le regarde.
    expect(membres(IMBRIQUE).map(m => m.name)).not.toContain('ScrolledTop');
  });
});

describe.skipIf(!mod)('G10 — la branche scellee que rien ne construit', () => {
  it.fails('rapporte un sous type imbrique qu aucun when ne traite', () => {
    expect(nomme(symboles(IMBRIQUE), 'ScrolledTop')).toBe(true);
  });

  it.fails('rapporte une data class imbriquee que rien n instancie', () => {
    const avecDonnees = f(`${MAIN}/State.kt`, [
      'package com.x',
      '',
      'sealed class State {',
      '    data object Loading : State()',
      '    data class Ready(val items: List<String>) : State()',
      '    data class Failed(val cause: Throwable) : State()',
      '}',
      '',
      'fun render(s: State) = when (s) {',
      '    is State.Loading -> "load"',
      '    is State.Ready -> "ready"',
      '    else -> ""',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(avecDonnees), 'Failed')).toBe(true);
  });

  it.fails('rapporte un sous type d une sealed INTERFACE', () => {
 // utilise cette forme la.
    const iface = f(`${MAIN}/TapStoryEvent.kt`, [
      'package com.x',
      '',
      'sealed interface TapStoryEvent {',
      '    data object Tapped : TapStoryEvent',
      '    data object NeverEmitted : TapStoryEvent',
      '}',
      '',
      'fun handle(e: TapStoryEvent) = when (e) {',
      '    is TapStoryEvent.Tapped -> 1',
      '    else -> 0',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(iface), 'NeverEmitted')).toBe(true);
  });

  it.fails('ronde deux : rapporte la branche dont le seul lecteur vient d etre coupe', () => {
    // Le corpus est donne sans la fonction `label`, comme la boucle de point
    // fixe le verrait apres sa suppression. Les trois branches deviennent
    // alors orphelines ensemble.
    const sansLecteur = f(`${MAIN}/FeedScrollState.kt`, [
      'package com.x',
      '',
      'sealed class FeedScrollState {',
      '    data object ScrollDown : FeedScrollState()',
      '    data object ScrollUp : FeedScrollState()',
      '    data object ScrolledTop : FeedScrollState()',
      '}',
      '',
    ].join('\n'));
    const noms = symboles(sansLecteur).map(s => s.name);
    expect(noms).toEqual(expect.arrayContaining(
      ['ScrollDown', 'ScrollUp', 'ScrolledTop']));
  });

});

describe.skipIf(!mod)('G10 — ce qui est DEJA couvert, et qu il ne faut pas casser', () => {
  /**
   * Trouve en ecrivant ces tests : ce cas la etait marque `it.fails()` et il
   * PASSE. La coquille scellee est deja detectee, parce que la classe scellee
   * elle meme est au niveau zero et que `sealedClass` est une sorte candidate.
   *
   * Nuance par rapport a KJ-066 : un enum dont toutes les entrees meurent
   * avait besoin d une regle dediee, parce que les entrees et le type se
   * comptaient separement. Ici le type se juge tout seul. G10 ne porte donc
   * QUE sur les branches, pas sur la famille.
   */
  it('rapporte deja une famille scellee que plus rien ne nomme', () => {
    const toutMort = f(`${MAIN}/Orphan.kt`, [
      'package com.x',
      '',
      'sealed class Orphan {',
      '    data object A : Orphan()',
      '    data object B : Orphan()',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(toutMort), 'Orphan')).toBe(true);
  });
});

describe.skipIf(!mod)('G10 — les gardes, qui passent des maintenant', () => {
  /**
   * Chacune passe par `epargne`, qui exige le canari. Le canari est un
   * `object` de PREMIER NIVEAU, que le detecteur juge deja : ces gardes sont
   * donc vertes et significatives des maintenant, et non vacues. Elles
   * diront, apres l implementation, si elle emporte une branche vivante.
   */

  it('ne touche pas une branche qu un when traite', () => {
    epargne(symboles(IMBRIQUE, CANARI), 'ScrollDown');
  });

  it('ne touche pas une branche construite ailleurs', () => {
    const emetteur = f(`${MAIN}/Emitter.kt`, [
      'package com.x',
      '',
      'class Emitter {',
      '    fun emit() = FeedScrollState.ScrolledTop',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IMBRIQUE, emetteur, CANARI), 'ScrolledTop');
  });

  /**
   * Un `when` EXHAUSTIF ne nomme pas toujours chaque branche de facon
   * lisible : le compilateur Kotlin verifie l exhaustivite, et une branche
   * absente du texte peut etre couverte par un `is Parent ->` ou par un
   * `when` sur une valeur. Couper une branche change alors l exhaustivite du
   * `when` lui meme, qui ne compile plus.
   */
  it('ne touche pas une branche couverte par une destructuration du parent', () => {
    const parent = f(`${MAIN}/Handler.kt`, [
      'package com.x',
      '',
      'fun handle(s: FeedScrollState): Int = when (s) {',
      '    is FeedScrollState -> 1',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IMBRIQUE, parent, CANARI), 'ScrolledTop');
  });

  it('ne touche pas une branche que seul un test construit', () => {
    const test = f('/w/app/src/test/java/com/x/StateTest.kt', [
      'package com.x',
      '',
      'class StateTest {',
      '    fun make() = FeedScrollState.ScrolledTop',
      '}',
      '',
    ].join('\n'));
    const trouves = symboles(IMBRIQUE, test, CANARI);
    expect(trouves.map(s => s.name)).toContain('CanaryGone');
    expect(trouves.find(s => s.name === 'ScrolledTop')?.verdict)
      .not.toBe('unreferenced');
  });

  it('ne touche pas une branche serialisee, que son nom designe a distance', () => {
    // Une scellee annotee pour la serialisation est reconstruite par nom
    // depuis du JSON, exactement comme la garde E5 des enums le prevoit.
    const serialisee = f(`${MAIN}/Payload.kt`, [
      'package com.x',
      '',
      'import kotlinx.serialization.Serializable',
      '',
      '@Serializable',
      'sealed class Payload {',
      '    @Serializable',
      '    data object FromJson : Payload()',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(serialisee, CANARI), 'FromJson');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [A_PLAT], testSourceSets: ['/src/test/'] };
    expect(symb.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(symb.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
