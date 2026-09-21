import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G32 — un recouvrement qui ne recouvre rien.
 *
 * Recensement de `findUnusedResources`, la troisieme famille. Mesure sur le
 * corpus de reference : **1106 entrees de ressources**, dont **15 rapportees**
 * (anim 9, layout 5, menu 1).
 *
 * La famille n expose aucun `explain`, contrairement aux deux autres : il a
 * fallu reconstruire le cout de chaque garde depuis l exterieur. C est
 * exactement ce que G28 reclamait.
 *
 * ## La garde 5, et ce qu elle coute
 *
 * « Un nom defini dans plusieurs modules est un recouvrement ; le consommateur
 * de l un est le consommateur de l autre » (UnusedResourceProvider).
 * Le raisonnement est juste : `core/uikit` et `core/login` declarent tous deux
 * `drawable/ic_facebook`, et celui qui gagne depend de l ordre des modules,
 * que le scanner ne connait pas.
 *
 *   75 noms sont definis dans plusieurs modules, soit 271 fichiers
 *    1 de ces noms n est cite NULLE PART dans le corpus
 *
 * Ce nom est `layout/text_pair`, present deux fois :
 *
 *
 * Aucun `.kt`, `.java` ou `.xml` du projet ne le nomme. Les deux fichiers sont
 * morts, et la garde les couvre tous les deux.
 *
 * **La garde 5 coute donc un nom, deux fichiers.** Comme M3 en G31, c est une
 * garde large qu on mesure et qu on garde ; simplement, elle devrait se lever
 * quand AUCUNE des copies n est nommee, ce que l echappatoire
 * `unmentionedDuplicates` fait deja cote symboles (G24).
 *
 * ## Une sonde qui a menti d un facteur vingt cinq
 *
 * La premiere mesure annonçait 25 noms multi modules jamais nommes. Faux : son
 * expression de jetons incluait le point, donc `R.drawable.ic_facebook`
 * sortait comme UN jeton et `ic_facebook` seul n etait jamais produit. Quatre
 * exemples relus a la main etaient tous vivants. Le point retire, il en reste
 * un.
 *
 * C est la cinquieme sonde de ce dossier a rendre un chiffre faux. Les quatre
 * precedentes : le denominateur des assets (83 au lieu de 8), les bascules M6
 * (62 au lieu d aucune verifiable), les copies F3 sans mention (25 au lieu de
 * rien), les F6 « par ancetre » (27 au lieu de zero). A chaque fois, relire
 * les trois premiers exemples a suffi.
 *
 * ## Ce que ces tests demandent
 *
 * Que la garde 5 se leve quand aucune copie n est nommee. Elle protege d une
 * ambiguite de RESOLUTION ; quand personne ne demande le nom, il n y a rien a
 * resoudre.
 */

const res: any = await importOrNull('src/providers/UnusedResourceProvider');

const A = '/w/appA';
const B = '/w/libB';
const f = (path: string, text: string) => ({ path, text });

const LAYOUT = '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />\n';

/** app/engagement/src/main/res/layout/text_pair.xml */
const DANS_A = f(`${A}/src/main/res/layout/text_pair.xml`, LAYOUT);

/** host/app/src/main/res/layout/text_pair.xml */
const DANS_B = f(`${B}/src/main/res/layout/text_pair.xml`, LAYOUT);

const CODE_A = f(`${A}/src/main/java/com/x/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');
const CODE_B = f(`${B}/src/main/java/com/y/Lib.kt`, 'package com.y\n\nfun lib() = 1\n');

const UTILISE = f(`${A}/src/main/java/com/x/Uses.kt`, [
  'package com.x',
  '',
  'fun go() = R.layout.text_pair',
  '',
].join('\n'));

const entree = (kind: string, name: string, ...variants: { path: string; moduleDir: string }[]) =>
  ({ kind, name, variants });

const UNE_COPIE = entree('layout', 'text_pair', { path: DANS_A.path, moduleDir: A });
const DEUX_COPIES = entree('layout', 'text_pair',
  { path: DANS_A.path, moduleDir: A }, { path: DANS_B.path, moduleDir: B });

const scan = (sources: any[], entries: any[], modules: string[], extra: any = {}) =>
  (res.findUnusedResources({
    sources, entries, modulesWithCode: modules, libraryModules: [], includeDrawables: true, ...extra,
  } as any) as any[]).map((r: any) => `${r.kind}/${r.name}`);

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!res)('la famille juge bien ce corpus', () => {
  it('un layout mort, declare une seule fois, est rapporte', () => {
    expect(scan([DANS_A, CODE_A], [UNE_COPIE], [A])).toEqual(['layout/text_pair']);
  });

  it('et il ne l est plus des que quelqu un le nomme', () => {
    expect(scan([DANS_A, CODE_A, UTILISE], [UNE_COPIE], [A])).toEqual([]);
  });
});

// ── Une seconde copie ne couvre plus rien ──────────────────────────────────

describe.skipIf(!res)('une seconde copie ne couvre plus rien', () => {
  /**
   * Le meme layout, mort dans les deux modules, cessait d etre rapporte du
   * seul fait d exister deux fois. La garde protege d une ambiguite de
   * RESOLUTION : quand personne ne demande le nom, il n y a rien a resoudre.
   */
  it('le meme layout, mort deux fois, est rapporte', () => {
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B], [DEUX_COPIES], [A, B]))
      .toEqual(['layout/text_pair']);
  });

  it('alors que la version a une seule copie l est', () => {
    expect(scan([DANS_A, CODE_A], [UNE_COPIE], [A])).toEqual(['layout/text_pair']);
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!res)('un recouvrement que personne ne demande', () => {
  it('deux copies mortes sont rapportees', () => {
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B], [DEUX_COPIES], [A, B]))
      .toEqual(['layout/text_pair']);
  });

  /**
   * Et la trouvaille devrait porter les DEUX chemins, puisque les deux
   * fichiers partent ensemble.
   */
  it('et la trouvaille nomme les deux fichiers', () => {
    const trouve = (res.findUnusedResources({
      sources: [DANS_A, DANS_B, CODE_A, CODE_B], entries: [DEUX_COPIES],
      modulesWithCode: [A, B], libraryModules: [], includeDrawables: true,
    } as any) as any[])[0];
    expect(trouve?.paths).toHaveLength(2);
  });

  /**
   * Trois copies ne changent rien au raisonnement : si aucune n est nommee, il
   * n y a aucune resolution a faire. Le corpus compte des noms presents dans
   * quatre modules, comme `anim/no_animation`.
   */
  it('trois copies mortes aussi', () => {
    const C = '/w/libC';
    const dansC = f(`${C}/src/main/res/layout/text_pair.xml`, LAYOUT);
    const codeC = f(`${C}/src/main/java/com/z/Autre.kt`, 'package com.z\n\nfun autre() = 1\n');
    const trois = entree('layout', 'text_pair',
      { path: DANS_A.path, moduleDir: A },
      { path: DANS_B.path, moduleDir: B },
      { path: dansC.path, moduleDir: C });
    expect(scan([DANS_A, DANS_B, dansC, CODE_A, CODE_B, codeC], [trois], [A, B, C]))
      .toEqual(['layout/text_pair']);
  });
});

// ── Le motif reel, et ce que la sonde avait manque ─────────────────

/**
 * `text_pair` N EST PAS mort, et la sonde de G32 s est trompee une sixieme
 * fois. Aucun `.kt`, `.java` ni `.xml` du projet n ecrit la chaine
 * `text_pair` : c est vrai, et c est ce que la sonde a mesure. Mais le view
 * binding genere `TextPairBinding`, et DEUX modules l importent :
 *
 *       import com.example.app.inappmessage.databinding.TextPairBinding
 *       import com.example.host.databinding.TextPairBinding
 *
 * Chaque module utilise SA copie. Le detecteur le savait deja, par son
 * ensemble `bindings` ; c est la relecture a la main qui avait manque le
 * chemin. Le correctif de G32 reste juste, et il ne rapporte rien ici.
 */
describe.skipIf(!res)('le view binding nomme le layout sans ecrire son nom', () => {
  const BINDING_A = f(`${A}/src/main/java/com/x/Braze.kt`, [
    'package com.x',
    '',
    'import com.example.app.inappmessage.databinding.TextPairBinding',
    '',
    'fun vue() = TextPairBinding.inflate(inflater, parent, false)',
    '',
  ].join('\n'));
  const BINDING_B = f(`${B}/src/main/java/com/y/Braze.kt`, [
    'package com.y',
    '',
    'import com.example.host.databinding.TextPairBinding',
    '',
    'fun vue() = TextPairBinding.inflate(inflater, parent, false)',
    '',
  ].join('\n'));

  it('deux copies, chacune tenue par le binding de son module', () => {
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B, BINDING_A, BINDING_B], [DEUX_COPIES], [A, B]))
      .toEqual([]);
  });

  /**
   * Et le binding d UN SEUL module suffit, parce que le nom genere est le meme
   * des deux cotes : impossible de dire laquelle des deux copies il atteint.
   * C est exactement l ambiguite de resolution que la garde protege, et elle
   * s applique donc encore ici.
   */
  it('et le binding d un seul module les tient toutes les deux', () => {
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B, BINDING_A], [DEUX_COPIES], [A, B]))
      .toEqual([]);
  });
});

// ── Gardes : ce que la garde 5 protege vraiment ────────────────────────────

describe.skipIf(!res)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(scan([DANS_A, CODE_A], [UNE_COPIE], [A])).toEqual(['layout/text_pair']);

  /**
   * Le motif pour lequel la garde existe. `core/uikit` et `core/login`
   * declarent tous deux `drawable/ic_facebook`, et celui qui gagne depend de
   * l ordre des modules, que le scanner ne connait pas. Une seule mention
   * suffit donc a sauver les deux copies.
   */
  it('une mention depuis un module sauve les deux copies', () => {
    temoin();
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B, UTILISE], [DEUX_COPIES], [A, B])).toEqual([]);
  });

  it('et une mention depuis l AUTRE module aussi', () => {
    temoin();
    const utiliseB = f(`${B}/src/main/java/com/y/Uses.kt`, [
      'package com.y',
      '',
      'fun go() = R.layout.text_pair',
      '',
    ].join('\n'));
    expect(scan([DANS_A, DANS_B, CODE_A, CODE_B, utiliseB], [DEUX_COPIES], [A, B])).toEqual([]);
  });

  /**
   * Garde 4, mesuree au passage : un module sans code ne peut pas consommer
   * ses propres fichiers, donc on ne conclut rien sur eux.
   */
  it('un module sans code ne rend rien', () => {
    expect(scan([DANS_B], [entree('layout', 'text_pair', { path: DANS_B.path, moduleDir: B })], []))
      .toEqual([]);
  });

  /**
   * Garde 1 : une recherche dynamique par nom eteint la sorte entiere. Un
   * `getIdentifier` quelque part, et plus aucun layout n est prouvable.
   */
  it('une recherche dynamique eteint la sorte', () => {
    temoin();
    const dynamique = f(`${A}/src/main/java/com/x/Dyn.kt`, [
      'package com.x',
      '',
      'fun pick(nom: String) = resources.getIdentifier(nom, "layout", packageName)',
      '',
    ].join('\n'));
    expect(scan([DANS_A, CODE_A, dynamique], [UNE_COPIE], [A])).toEqual([]);
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    temoin();
    expect(scan([DANS_A, CODE_A], [UNE_COPIE], [A], { truncated: true })).toEqual([]);
  });
});
