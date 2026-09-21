import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G12 — une declaration imbriquee n est jamais jugee comme un TOUT.
 *
 * Voir doc/gaps-detection.md. C est la generalisation de G10, trouvee en
 * auditant la diversite syntaxique des fixtures : toutes celles ecrites
 * jusque la declaraient au premier niveau, alors que le corpus imbrique
 * beaucoup.
 *
 * ## Combien, sur le corpus de reference
 *
 *   class      811 imbriquees sur 5343  (15 %)
 *   object     385 imbriquees sur  614  (63 %)
 *   interface  150 imbriquees sur  726  (21 %)
 *   enum       120 imbriquees sur  306  (39 %)
 *   TOTAL     1466 imbriquees sur 6989  (21 %)
 *
 * Une declaration sur cinq est imbriquee. `findUnusedSymbols` ne descend pas
 * sous le niveau zero, donc aucune n est un symbole candidat.
 *
 * **Mais ce chiffre mesure une COUVERTURE, pas un gain.** En ecartant les
 * declarations annotees et celles qui portent un supertype, il reste 633
 * declarations imbriquees, dont CINQ seulement ne sont nommees nulle part
 * ailleurs, soit 0,8 %. Et parmi ces cinq, au moins une est deja rapportee
 * par une autre famille : voir le bloc sur le recouvrement avec KJ-066.
 *
 * ## Le trou n est pas le meme selon la sorte, et c est la nuance
 *
 * Mesure faite avant d ecrire ces tests, sur des corpus minimaux ou seule la
 * sorte imbriquee change :
 *
 *   class Inner     -> membres: Holder.Inner.work   symboles: (rien)
 *   object Singleton-> membres: Holder.Singleton.work symboles: (rien)
 *   interface Listener -> membres: (rien)           symboles: (rien)
 *   enum class Mode -> membres: (rien)              symboles: (rien)
 *   temoin, fun     -> membres: Holder.neverCalled  symboles: (rien)
 *
 * Deux regimes, donc.
 *
 * **Classes et objects imbriques : couverts A MOITIE.** `unusedMembers` voit
 * leurs methodes et les rapporte, mais jamais la declaration qui les
 * contient. Couper ce qu il rapporte laisse `class Inner {}` debout, vide.
 * C est exactement la coquille que KJ-066 a du apprendre a emporter pour les
 * enums dont toutes les entrees meurent.
 *
 * **Interfaces et enums imbriques : INVISIBLES.** Ni membre, ni symbole. Les
 * 270 declarations de ces deux sortes ne sont regardees par personne.
 *
 * ## Ce que ca change pour G4, G7 et G10
 *
 * G4 et G7 raisonnent sur des interfaces ; ils ne s appliquent donc qu aux
 * 576 declarees au premier niveau, pas aux 150 imbriquees. G10 est le cas
 * particulier des branches scellees. Les trois sont plafonnes par ce trou ci.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const enums: any = await importOrNull('src/providers/unusedEnumEntries');
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

/** Le canari : la meme sorte, mais au PREMIER NIVEAU. Juge des aujourd hui. */
const CANARI = f(`${MAIN}/CanaryGone.kt`, [
  'package com.x',
  '',
  'interface CanaryGone {',
  '    fun gone()',
  '}',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures : une sorte imbriquee par cas, tout le reste identique ────────

/** `keepAlive` empeche `Holder` de mourir, pour isoler la sorte imbriquee. */
const enveloppe = (corps: string[]) => f(`${MAIN}/Holder.kt`, [
  'package com.x',
  '',
  'class Holder {',
  ...corps,
  '}',
  '',
  'fun keepAlive(h: Holder) = h',
  '',
].join('\n'));

const CLASSE = enveloppe(['    class Inner {', '        fun work() = 1', '    }']);
const OBJET = enveloppe(['    object Singleton {', '        fun work() = 1', '    }']);
const IFACE = enveloppe(['    interface Listener {', '        fun onEvent()', '    }']);
const ENUM = enveloppe(['    enum class Mode { A, B }']);

describe.skipIf(!mod)('G12 — le corpus de test est lisible', () => {
  it('rapporte une interface declaree au PREMIER NIVEAU', () => {
    expect(nomme(symboles(CANARI), 'CanaryGone')).toBe(true);
  });

  it('rapporte une methode membre morte, la sorte que le detecteur voit', () => {
    const temoin = enveloppe(['    fun neverCalled() = 1']);
    expect(nomme(membres(temoin), 'neverCalled')).toBe(true);
  });

  /**
   * SENTINELLE. Elle fixe les DEUX regimes mesures. Si l une des quatre
   * lignes bouge, l entree G12 du document doit etre relue, et G10 avec elle
   * puisqu il en est un cas particulier.
   */
  it('aujourd hui, aucune sorte imbriquee n est un symbole candidat', () => {
    // `keepAlive` est une fonction de premier niveau que rien n appelle : elle
    // EST rapportee, et c est bien la preuve que le detecteur lit la fixture.
    // Ce qui compte est qu aucun nom IMBRIQUE ne sorte avec elle.
    for (const [fixture, imbrique] of [
      [CLASSE, 'Inner'], [OBJET, 'Singleton'], [IFACE, 'Listener'], [ENUM, 'Mode'],
    ] as const) {
      const noms = symboles(fixture).map(s => s.name);
      expect(noms).toContain('keepAlive');
      expect(noms).not.toContain(imbrique);
    }
    // Les deux premieres voient leur METHODE rapportee, pas les deux autres.
    expect(membres(CLASSE).map(m => m.name)).toContain('work');
    expect(membres(OBJET).map(m => m.name)).toContain('work');
    expect(membres(IFACE)).toHaveLength(0);
    expect(membres(ENUM)).toHaveLength(0);
  });
});

/**
 * CE QUI EST DEJA COUVERT PAR UNE AUTRE FAMILLE, et qu il ne faut pas compter
 * deux fois.
 *
 * En estimant l ampleur de G12, cinq declarations imbriquees sur 633 ne sont
 * nommees nulle part ailleurs. La deuxieme est un cas d ecole :
 *
 *       enum OrderBy {
 *       }
 *
 * C est litteralement la coquille que la documentation de KJ-066 decrit, et
 * elle est encore dans le corpus. On pourrait croire a un trou de G12,
 * puisqu elle est imbriquee dans une interface.
 *
 * Mesure faite : elle est DEJA rapportee, mais par une autre voie.
 *
 *   enum vide IMBRIQUE        -> scanEnums le rend dans `emptied`
 *   enum vide PREMIER NIVEAU  -> findUnusedSymbols le rend comme symbole
 *
 * Les deux formes sont couvertes, par deux familles differentes. G12 ne porte
 * donc PAS sur les enums vides, et son ampleur reelle est plus faible que les
 * cinq cas bruts ne le laissent croire.
 *
 * Lecon generale : les familles se recouvrent, donc additionner leurs
 * ampleurs surestime le total. Chaque chiffre du document doit se lire comme
 * « ce que cette famille verrait », pas « ce que personne ne voit ».
 */
describe.skipIf(!enums)('G12 — le recouvrement avec KJ-066', () => {
  it('rapporte deja un enum vide imbrique, via la famille des enums', () => {
    const service = f(`${MAIN}/DatabaseService.java`, [
      'package com.x;',
      '',
      'public interface DatabaseService {',
      '',
      '\tvoid update(String url);',
      '',
      '\tenum OrderBy {',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const r = enums.scanEnums({
      sources: [service], testSourceSets: ['/src/test/'],
    }) as any;
    expect(r.emptied.map((x: any) => x.enumName)).toContain('OrderBy');
  });

  it('rapporte deja un enum vide de premier niveau, via les symboles', () => {
    const plat = f(`${MAIN}/OrderBy.java`, [
      'package com.x;',
      '',
      'public enum OrderBy {',
      '}',
      '',
    ].join('\n'));
    expect(symboles(plat).map((s: any) => s.name)).toContain('OrderBy');
  });
});

describe.skipIf(!mod)('G12 — la coquille que la coupe laisse debout', () => {
  /**
   * Couper ce que `unusedMembers` rapporte sur `CLASSE` enleve `work()` et
   * laisse `class Inner {}` vide. Le detecteur doit rapporter la declaration
   * ELLE MEME, comme KJ-066 le fait pour un enum vide.
   */
  it.fails('rapporte une classe imbriquee que rien ne nomme, pas seulement sa methode', () => {
    expect(nomme(symboles(CLASSE), 'Inner')).toBe(true);
  });

  it.fails('rapporte un object imbrique que rien ne nomme', () => {
    expect(nomme(symboles(OBJET), 'Singleton')).toBe(true);
  });
});

describe.skipIf(!mod)('G12 — les sortes que personne ne regarde', () => {
  it.fails('rapporte une interface imbriquee que rien ne nomme', () => {
    expect(nomme(symboles(IFACE), 'Listener')).toBe(true);
  });

  it.fails('rapporte un enum imbrique que rien ne nomme', () => {
    expect(nomme(symboles(ENUM), 'Mode')).toBe(true);
  });

  it.fails('rapporte une interface imbriquee en Java', () => {
    // 150 interfaces imbriquees sur le corpus, les deux langages confondus.
    const java = f(`${MAIN}/Outer.java`, [
      'package com.x;',
      '',
      'public class Outer {',
      '',
      '\tpublic interface Listener {',
      '\t\tvoid onEvent();',
      '\t}',
      '}',
      '',
      'class Keep { Outer o; }',
      '',
    ].join('\n'));
    expect(nomme(symboles(java), 'Listener')).toBe(true);
  });

  it.fails('rapporte une declaration imbriquee a DEUX niveaux', () => {
    const profond = f(`${MAIN}/Deep.kt`, [
      'package com.x',
      '',
      'class Outer {',
      '    class Middle {',
      '        interface Deepest {',
      '            fun go()',
      '        }',
      '    }',
      '}',
      '',
      'fun keepAlive(o: Outer) = o',
      '',
    ].join('\n'));
    expect(nomme(symboles(profond), 'Deepest')).toBe(true);
  });
});

describe.skipIf(!mod)('G12 — les gardes, qui passent des maintenant', () => {
  /**
   * Chacune passe par `epargne`, qui exige le canari. Le canari est une
   * interface de PREMIER NIVEAU, que le detecteur juge deja : ces gardes sont
   * donc vertes et significatives des maintenant. Elles diront, apres
   * l implementation, si elle emporte une declaration imbriquee vivante.
   */

  it('ne touche pas une classe imbriquee que son fichier instancie', () => {
    const utilisee = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder {',
      '    class Inner',
      '',
      '    fun make() = Inner()',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(utilisee, CANARI), 'Inner');
  });

  it('ne touche pas une classe imbriquee nommee depuis un autre fichier', () => {
    const ailleurs = f(`${MAIN}/User.kt`, [
      'package com.x',
      '',
      'fun use(i: Holder.Inner) = i',
      '',
    ].join('\n'));
    epargne(symboles(CLASSE, ailleurs, CANARI), 'Inner');
  });

  it('ne touche pas une interface imbriquee qu une classe implemente', () => {
    const impl = f(`${MAIN}/Impl.kt`, [
      'package com.x',
      '',
      'class Impl : Holder.Listener {',
      '    override fun onEvent() = Unit',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IFACE, impl, CANARI), 'Listener');
  });

  /**
   * Une `Factory` imbriquee dans un `@Subcomponent` est instanciee par du
 * code genere. en est un
   * exemple, et le corpus en compte 67 annotees de la sorte.
   */
  it('ne touche pas une interface imbriquee annotee par un framework', () => {
    const sous = f(`${MAIN}/ActivitySubcomponent.kt`, [
      'package com.x',
      '',
      'import dagger.Subcomponent',
      '',
      '@Subcomponent',
      'interface ActivitySubcomponent {',
      '',
      '    @Subcomponent.Factory',
      '    interface Factory {',
      '        fun create(): ActivitySubcomponent',
      '    }',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(sous, CANARI), 'Factory');
  });

  it('ne touche pas un enum imbrique dont une entree est nommee ailleurs', () => {
    const lecteur = f(`${MAIN}/Reader.kt`, [
      'package com.x',
      '',
      'fun read() = Holder.Mode.A',
      '',
    ].join('\n'));
    epargne(symboles(ENUM, lecteur, CANARI), 'Mode');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [CANARI], testSourceSets: ['/src/test/'] };
    expect(symb.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(symb.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
