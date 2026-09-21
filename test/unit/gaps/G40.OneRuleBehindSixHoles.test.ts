import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G40 — la regle unique derriere six trous.
 *
 * Le recensement des onze familles est clos (G39). Deux defauts seulement s y
 * repetent, et celui ci porte six gaps a lui seul :
 *
 *   G21  un membre ecarte par F7 ancre ses voisins dans l ilot
 *   G22  une annotation de portee ancre ses voisins
 *   G27  un sous type annote cautionne son parent
 *   G29  une portee du projet ecarte tous les membres de sa classe
 *   G34  la meme portee fait disparaitre l ilot
 *   G38  un temoin ecarte suffit a conclure `selfOnly`
 *
 * Ce fichier ecrit la regle UNE FOIS et la met a l epreuve a chacun de ces
 * endroits, dans un seul appel par site. Il n ajoute pas de trouvaille : il
 * sert a verifier d un seul coup qu une correction faite quelque part vaut
 * partout.
 *
 * ## La regle
 *
 * Une declaration qu un filtre a ecartee n est pas PROUVEE VIVANTE, elle est
 * NON JUGEE. Elle ne doit donc pas servir de preuve de vie pour une autre
 * declaration.
 *
 * Un filtre repond « je ne sais pas ». Le detecteur, lui, traite cette absence
 * de savoir comme un certificat, et le transmet aux voisins de la declaration
 * ecartee. Le cout mesure sur le corpus de reference :
 *
 *   G29   1679 membres ecartes par une portee que le projet declare
 *   G34    269 declarations, meme cause, autre famille
 *   G27     93 interfaces cautionnees par une implementation annotee
 *   G38     34 verdicts `selfOnly` batis sur un temoin ecarte
 *   G21      1 dossier de neuf fichiers, entierement cache
 *
 * ## Comment chaque site est eprouve
 *
 * Deux appels par site, sur le MEME corpus a une chose pres : la declaration
 * temoin porte, ou non, ce qui la fait ecarter. Le premier appel est vert, il
 * montre que le detecteur sait juger la cible. Le second est le trou.
 *
 * C est la forme qui rend la regle visible : ce n est jamais la cible qui
 * change, c est seulement son voisin.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const iles: any = await importOrNull('src/providers/deadIslands');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const VIVANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

const symboles = (...sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(s => s.name);

const membres = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any) as any[])
    .map((m: any) => m.name);

const ilots = (...sources: { path: string; text: string }[]) =>
  (iles.findDeadIslands({ sources, testSourceSets: ['/src/test/'], maxIslandSize: 8 } as any) as any[])
    .map((i: any) => (i.members ?? []).map((m: any) => m.name).sort().join('+'));

/** La portee Dagger du projet, reconnaissable a son `@Scope` (KJ-070). */
const PORTEE = f('ScopeApplication.kt', [
  'package com.x',
  '',
  'import javax.inject.Scope',
  '',
  '@Scope',
  'annotation class ScopeApplication',
  '',
].join('\n'));

/** Une paire qui se tient mutuellement en vie, et que rien du dehors ne nomme. */
const paire = (annotation: string) => [
  f('Alpha.kt', [
    'package com.x',
    '',
    ...(annotation ? [annotation] : []),
    'class Alpha {',
    '',
    '    fun go() = Beta().back()',
    '}',
    '',
  ].join('\n')),
  f('Beta.kt', [
    'package com.x',
    '',
    ...(annotation ? [annotation] : []),
    'class Beta {',
    '',
    '    fun back() = Alpha()',
    '}',
    '',
  ].join('\n')),
];

// ── Site 1, G21 : un voisin ecarte par son supertype ───────────────────────

describe.skipIf(!iles)('G21, l ancre de supertype', () => {
  /**
   * Un dossier d utilitaires d un module meteo, neuf fichiers.
   * `StickyRecyclerHeadersAdapter` prolonge `RecyclerView`, donc F7 l ecarte.
   * Ecartee, elle nomme toujours ses voisins.
   */
  const ANCRE = f('Adapter.kt', [
    'package com.x',
    '',
    'class Adapter : RecyclerView {',
    '',
    '    fun use() = Alpha()',
    '}',
    '',
  ].join('\n'));

  it('sans l ancre, la paire est un ilot entier', () => {
    expect(ilots(...paire(''), VIVANT)).toEqual(['Alpha+Beta+back+go']);
  });

  /**
   * Corrige par KJ-075, premier site de la regle referme. L ancre n est plus
   * l exterieur de l ilot : elle y entre, et elle y meurt avec le reste
   * puisque rien ne la construit non plus.
   */
  it('avec elle, Alpha reste dans l ilot', () => {
    const vus = ilots(...paire(''), ANCRE, VIVANT).join(' ');
    expect(vus).toContain('Alpha');
  });

  /**
   * L ancre elle meme n entre plus dans l ilot, et c est mieux : KJ-080 l a
   * retiree de F7, donc la famille des SYMBOLES la juge morte avant que celle
   * des ilots ait a la ramasser. Une trouvaille plus simple pour le meme code.
   */
  it('et l ancre est jugee morte par la famille des symboles', () => {
    expect(symb.findUnusedSymbols({
      sources: [...paire(''), ANCRE, VIVANT], testSourceSets: ['/src/test/'],
    } as any).map((x: any) => x.name)).toContain('Adapter');
  });

  /**
   * La contrepartie, mesuree : que QUELQU UN construise l ancre, et elle tient
   * de nouveau ce qu elle nomme. La relache ne retire pas les F7 du calcul,
   * elle les y met.
   */
  it('mais une ancre que quelqu un construit tient de nouveau Alpha', () => {
    const appelant = f('Ecran.kt', [
      'package com.x',
      '',
      'fun ouvre() = Adapter().use()',
      '',
      'fun main() {',
      '    ouvre()',
      '}',
      '',
    ].join('\n'));
    expect(ilots(...paire(''), ANCRE, appelant, VIVANT)).toEqual(['Beta+back+go']);
  });
});

// ── Site 2, G27 : un sous type annote cautionne son parent ─────────────────

describe.skipIf(!symb)('G27, la caution du sous type', () => {
  /** core/ui/.../audio/repository/AudioRepository.kt:3 */
  const INTERFACE = f('Repo.kt', [
    'package com.x',
    '',
    'interface Repo {',
    '',
    '    fun load(): Int',
    '}',
    '',
  ].join('\n'));

  const impl = (annotation: string) => f('Noop.kt', [
    'package com.x',
    '',
    ...(annotation ? [annotation] : []),
    'class Noop : Repo {',
    '',
    '    override fun load() = 0',
    '}',
    '',
  ].join('\n'));

  it('sans annotation, l implementation orpheline est rapportee', () => {
    expect(symboles(INTERFACE, impl(''), VIVANT)).toContain('Noop');
  });

  it.fails('avec elle, le corpus devrait rendre le meme verdict', () => {
    expect(symboles(INTERFACE, impl('@Serializable'), VIVANT)).toContain('Noop');
  });

  it('aujourd hui, l annotation eteint l implementation ET son parent', () => {
    expect(symboles(INTERFACE, impl('@Serializable'), VIVANT)).toEqual([]);
  });
});

// ── Site 3, G29 : la portee du projet, chez les membres ────────────────────

describe.skipIf(!memb)('G29, la portee qui ecarte les membres', () => {
  /** app/.../utils/pagenumber/PageNumberCache.java:10 */
  const service = (annotation: string) => f('Service.kt', [
    'package com.x',
    '',
    ...(annotation ? [annotation] : []),
    'class Service {',
    '',
    '    fun used() = 1',
    '',
    '    fun neverCalled() = 2',
    '}',
    '',
  ].join('\n'));

  const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');

  it('sans annotation, la methode morte est rapportee', () => {
    expect(membres(service(''), APPELANT)).toContain('neverCalled');
  });

  it('avec une portee que le projet DECLARE, elle l est encore', () => {
    expect(membres(PORTEE, service('@ScopeApplication'), APPELANT)).toContain('neverCalled');
  });

  /**
   * `unusedSymbols` sait pourtant reconnaitre cette portee depuis KJ-070 : la
   * classe sort `alive:main`, pas `F5`. C est la famille des membres qui n a
   * pas reçu la decouverte.
   */
  it('alors que unusedSymbols, lui, reconnait la portee', () => {
    const vu = (symb.explainSymbols({
      sources: [PORTEE, service('@ScopeApplication'), APPELANT], testSourceSets: ['/src/test/'],
    } as any) as any[]).find(s => s.name === 'Service');
    expect(vu).toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Site 4, G34 : la meme portee, chez les ilots ───────────────────────────

describe.skipIf(!iles)('G34, la portee qui efface l ilot', () => {
  it('sans annotation, la paire est un ilot', () => {
    expect(ilots(...paire(''), VIVANT)).toEqual(['Alpha+Beta+back+go']);
  });

  it('avec une portee declaree, elle le reste', () => {
    expect(ilots(PORTEE, ...paire('@ScopeApplication'), VIVANT)).toHaveLength(1);
  });

  it('et il ne disparait plus', () => {
    expect(ilots(PORTEE, ...paire('@ScopeApplication'), VIVANT)).toHaveLength(1);
  });
});

// ── Site 5, G38 : le temoin ecarte d un verdict selfOnly ───────────────────

describe.skipIf(!memb)('G38, le temoin ecarte', () => {
  const porteur = (annotation: string) => f('S2.kt', [
    'package com.x',
    '',
    'class S2 {',
    '',
    '    fun used() = 1',
    '',
    ...(annotation ? [`    ${annotation}`] : []),
    '    fun witness() = helper()',
    '',
    '    fun helper() = 2',
    '}',
    '',
  ].join('\n'));

  const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    S2().used()\n}\n');

  it('sans annotation, le temoin mort est rapporte', () => {
    expect(membres(porteur(''), APPELANT)).toContain('witness');
  });

  it.fails('avec elle, le temoin devrait l etre encore', () => {
    expect(membres(porteur('@Nullable'), APPELANT)).toContain('witness');
  });

  it('aujourd hui, plus rien n est rapporte', () => {
    expect(membres(porteur('@Nullable'), APPELANT)).toEqual([]);
  });
});

// ── Gardes : la regle ne dit rien des vrais points d entree ────────────────

describe.skipIf(!symb || !memb || !iles)('ce que la regle ne doit pas emporter', () => {
  /**
   * La regle porte sur les filtres qui disent « je ne sais pas ». Elle ne
   * porte pas sur les annotations qui designent un vrai point d entree : la un
   * cadre APPELLE le code, et la caution est fondee.
   */
  it('un @Module, dont le code genere appelle les fournitures', () => {
    expect(ilots(...paire('@Module'), VIVANT)).toEqual([]);
    expect(ilots(...paire(''), VIVANT)).toHaveLength(1);
  });

  it('un @Parcelize, que le systeme reconstruit', () => {
    expect(ilots(...paire('@Parcelize'), VIVANT)).toEqual([]);
  });

  it('un @Subscribe, que le bus appelle', () => {
    const porteur = f('S3.kt', [
      'package com.x',
      '',
      'class S3 {',
      '',
      '    fun used() = 1',
      '',
      '    @Subscribe',
      '    fun onEvent() = helper()',
      '',
      '    fun helper() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    S3().used()\n}\n');
    expect(membres(porteur, appel)).not.toContain('helper');
  });

  /**
   * Et la borne de KJ-070 : une annotation que le corpus ne declare PAS reste
   * etrangere. La relache ne doit pas s appliquer a n importe quel nom.
   */
  it('une portee que le corpus ne declare pas reste etrangere', () => {
    const service = f('Service.kt', [
      'package com.x',
      '',
      '@ScopeApplication',
      'class Service {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');
    expect(membres(service, appel)).not.toContain('neverCalled');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    expect(symb.findUnusedSymbols({
      sources: [...paire(''), VIVANT], testSourceSets: ['/src/test/'], truncated: true,
    } as any)).toHaveLength(0);
  });
});
