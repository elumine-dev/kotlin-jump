import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G34 — la meme decouverte manquante une troisieme fois.
 *
 * Recensement de `findDeadIslands`, cinquieme et derniere famille. Il clot le
 * tour des cinq, et il donne deux resultats.
 *
 * ## Resultat 1 : la limite de taille ne mord jamais
 *
 * `explainIslands` rend 26003 explications sur le corpus de reference. En
 * faisant varier `maxIslandSize` :
 *
 *   limite   8 -> 4 ilots, tailles 4, 3, 3, 2
 *   limite  16 -> 4 ilots, identiques
 *   limite  64 -> 4 ilots, identiques
 *   limite 256 -> 4 ilots, identiques
 *
 * Et `I8:max-size` n apparait **jamais** dans les explications. La falaise de
 * G13 ne coute donc rien sur ce corpus : le plus gros ilot y fait quatre
 * membres. G13 avait deja ete corrige une fois (le circuit defait chaines et
 * cycles) ; ceci le corrige une seconde fois, au niveau de la famille elle
 * meme. La limite est un plafond de cout, pas une perte.
 *
 * ## Resultat 2 : la decouverte de KJ-070 manque ici aussi
 *
 * Les rejets propres a la famille se repartissent ainsi :
 *
 *   I2:@ScopeApplication       189
 *   I6:subsumed                 66
 *   I2:@ScopeActivity           58
 *   I2:@Module                  32
 *   I2:@ScopeFragment           20
 *   I3:refused-extent            7
 *   I2:@UnstableApi              7
 *   I2:@optics, @JvmName         10
 *   I2:@ScopeGridGameFragment    2
 *   le reste, une poignee
 *
 * **269 declarations** (189 + 58 + 20 + 2) sont ecartees par des annotations
 * de portee Dagger que le PROJET declare : `@ScopeApplication`,
 * `@ScopeActivity`, `@ScopeFragment`, `@ScopeGridGameFragment`.
 *
 * KJ-070 a appris a `unusedSymbols` a les reconnaitre en collectant les
 * annotations du workspace portant `@Scope`. G29 a montre que
 * `unusedMembers` ne l avait pas reçue, au prix de 1679 membres. Voici la
 * troisieme famille, et le meme manque.
 *
 *   unusedSymbols   la decouverte est appliquee
 *   unusedMembers   absente, 1679 membres ecartes (G29)
 *   deadIslands     absente, 269 declarations ecartees
 *
 * Soit **1948 declarations** ecartees pour une raison qu une famille du meme
 * depot sait deja lever.
 *
 * ## Ce que ces tests demandent
 *
 * Que la decouverte traverse, ici comme en G29. La garde est la meme et elle
 * est nette : un `@Module` est instancie par le code genere, un `@Parcelize`
 * par le systeme, une portee ne fait qu attribuer un cycle de vie a une
 * classe que du code ordinaire appelle.
 */

const iles: any = await importOrNull('src/providers/deadIslands');
const symb: any = await importOrNull('src/providers/unusedSymbols');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[], maxIslandSize = 8) =>
  ({ sources, testSourceSets: ['/src/test/'], maxIslandSize } as any);

const ilots = (sources: { path: string; text: string }[], maxIslandSize = 8) =>
  (iles.findDeadIslands(base(sources, maxIslandSize)) as any[])
    .map((i: any) => (i.members ?? []).map((m: any) => m.name).sort().join('+'));

const symbole = (nom: string, ...sources: { path: string; text: string }[]) =>
  (symb.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom);

/**
 * Une portee Dagger declaree par le projet, reconnaissable a son `@Scope`.
 * Motif reel:
 */
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

const VIVANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!iles)('la famille voit bien cette paire', () => {
  it('sans annotation, la paire mutuelle est un ilot', () => {
    const vus = ilots([...paire(''), VIVANT]);
    expect(vus).toHaveLength(1);
    expect(vus[0]).toContain('Alpha');
    expect(vus[0]).toContain('Beta');
  });
});

// ── Resultat 1 : la limite de taille ────────────────────────────────────────

describe.skipIf(!iles)('la limite de taille, mesuree', () => {
  /**
   * Sur le corpus, faire varier la limite de 8 a 256 ne change rien : quatre
   * ilots, de tailles 4, 3, 3 et 2, et `I8:max-size` n apparait jamais. Le
   * temoin ci dessous reproduit la meme insensibilite en petit.
   */
  it('le verdict ne change pas de la limite 8 a la limite 256', () => {
    const sources = [...paire(''), VIVANT];
    expect(ilots(sources, 8)).toEqual(ilots(sources, 256));
  });

  /**
   * Et la limite mord bel et bien quand on la descend sous la taille de l
   * ilot : elle fonctionne, elle ne sert simplement a rien ici.
   */
  it('mais elle mord quand on la descend sous la taille de l ilot', () => {
    expect(ilots([...paire(''), VIVANT], 2)).toEqual([]);
  });
});

// ── Resultat 2 : la decouverte manquante ────────────────────────────────────

describe.skipIf(!iles || !symb)('aujourd hui, la decouverte ne traverse pas', () => {
  const CORPUS = [PORTEE, ...paire('@ScopeApplication'), VIVANT];

  it('unusedSymbols reconnait la portee du projet', () => {
    expect(symbole('Alpha', ...CORPUS)).toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * CORRIGÉ. Même correctif qu'en G29, appliqué à `foreignAnnotationFor` :
   * sur le corpus, les îlots passent de 20 à 30.
   */
  it('deadIslands la reconnait desormais et garde l ilot', () => {
    expect(ilots(CORPUS)).toHaveLength(1);
  });

  /**
   * La meme paire, sans l annotation, EST un ilot. La seule difference est une
   * annotation que l autre famille sait deja lever.
   */
  it('alors que la meme paire sans annotation en est un', () => {
    expect(ilots([...paire(''), VIVANT])).toHaveLength(1);
  });

  /**
   * Et la decouverte cote symboles depend bien du fichier qui declare la
   * portee : sans lui, `unusedSymbols` retombe sur F5. Ce qui prouve que c est
   * la decouverte, et non un cas code en dur.
   */
  it('sans le fichier qui declare la portee, les symboles retombent sur F5', () => {
    expect(symbole('Alpha', ...paire('@ScopeApplication'), VIVANT))
      .toMatchObject({ outcome: 'F5:@ScopeApplication' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!iles)('la decouverte devrait traverser ici aussi', () => {
  it('une paire a portee du projet reste un ilot', () => {
    expect(ilots([PORTEE, ...paire('@ScopeApplication'), VIVANT])).toHaveLength(1);
  });

  it('et l ilot nomme ses deux classes', () => {
    const vus = ilots([PORTEE, ...paire('@ScopeApplication'), VIVANT]).join(' ');
    expect(vus).toContain('Alpha');
    expect(vus).toContain('Beta');
  });

  /**
   * `@UnstableApi` ecarte sept declarations ici et 394 membres en G29. C est
   * un marqueur de stabilite, il ne dit rien de qui appelle.
   */
  it.fails('un marqueur de stabilite ne devrait rien ecarter non plus', () => {
    expect(ilots([...paire('@UnstableApi'), VIVANT])).toHaveLength(1);
  });
});

// ── Gardes : les annotations qui fabriquent vraiment ───────────────────────

describe.skipIf(!iles)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(ilots([...paire(''), VIVANT])).toHaveLength(1);

  /**
   * Trente-deux declarations du corpus. Un `@Module` est instancie par le code
   * genere de Dagger, que le corpus ne contient pas.
 * Motif reel:
   */
  it('un @Module, instancie par le code genere', () => {
    temoin();
    expect(ilots([...paire('@Module'), VIVANT])).toEqual([]);
  });

  /**
 * Motif reel:. Le systeme reconstruit
   * un `@Parcelize` depuis un Parcel, sans que son nom apparaisse.
   */
  it('un @Parcelize, reconstruit par le systeme', () => {
    temoin();
    expect(ilots([...paire('@Parcelize'), VIVANT])).toEqual([]);
  });

  it('un @Entity, que la base de donnees remplit', () => {
    temoin();
    expect(ilots([...paire('@Entity'), VIVANT])).toEqual([]);
  });

  /**
   * La garde qui borne la relache, la meme qu en G29 : une annotation que le
   * corpus ne declare PAS reste etrangere, sans quoi la relache s appliquerait
   * a n importe quelle annotation inconnue.
   */
  it('une portee que le corpus ne declare pas reste etrangere', () => {
    temoin();
    expect(ilots([...paire('@ScopeApplication'), VIVANT])).toEqual([]);
  });

  /**
   * Et une annotation du corpus qui ne porte pas `@Scope` n est pas une
   * portee : la declarer ne doit rien relacher.
   */
  it('une annotation du corpus sans @Scope n est pas une portee', () => {
    temoin();
    const marqueur = f('Marker.kt', [
      'package com.x',
      '',
      'annotation class ScopeApplication',
      '',
    ].join('\n'));
    expect(ilots([marqueur, ...paire('@ScopeApplication'), VIVANT])).toEqual([]);
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    temoin();
    expect(iles.findDeadIslands({ ...base([...paire(''), VIVANT]), truncated: true })).toHaveLength(0);
  });
});
