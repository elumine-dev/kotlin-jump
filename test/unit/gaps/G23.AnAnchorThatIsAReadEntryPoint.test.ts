import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G23 — le meme mecanisme chez les membres, et la frontiere de la regle.
 *
 * G21 et G22 ont etabli une regle : une declaration ecartee par un filtre
 * n est pas prouvee vivante, elle est non jugee, et la traiter comme une
 * preuve de vie pour ses voisines cache des groupes entiers.
 *
 * La piste ouverte par G22 demandait si le meme malentendu existait hors de
 * `unusedSymbols`. Trois familles ont ete sondees. Deux repondent non, une
 * repond oui mais SANS INSTANCE dans le corpus, et c est le resultat le plus
 * utile des trois : il dit ou la regle de G21 et G22 doit s arreter.
 *
 * ## Les trois sondages
 *
 * **Les entrees d enum : non.** Une entree lue laisse ses voisines etre
 * rapportees. `enum Mode { A, B, C }` avec un seul `Mode.A` lu rend `B, C`.
 * Pas d effet d ancre.
 *
 * **Les ressources : non, le circuit la defait.** Un layout mort qui nomme
 * `@drawable/panel_icon` empeche bien ce dessin d etre rapporte a la ronde 1,
 * mais la ronde 2 le rapporte une fois le layout parti. Mesure faite. La
 * cascade fonctionne, ce n est pas un trou.
 *
 * **Les membres : oui, le mecanisme est la.** Mesure faite sur un corpus
 * minimal, et c est exactement la forme de G21 :
 *
 *   avec le membre @Inject present  -> Holder.helper : selfOnly
 *   sans lui                        -> Holder.helper : unreferenced
 *
 * Un membre ecarte par M6 continue d appeler ses voisins, et ces appels les
 * font passer pour vivants.
 *
 * ## Et pourtant, aucune instance dans le corpus. Pourquoi, et pourquoi ca
 * ## compte
 *
 * Les 18128 membres examines se rangent ainsi : alive 5550, M2 4965, M4 4823,
 * M3 1240, M6 1119, selfOnly 230, le reste disperse. Les 1119 du filtre M6 se
 * repartissent par annotation :
 *
 *   @Inject 560 | @VisibleForTesting 163 | @Subscribe 159 | @Nullable 58
 *   @NonNull 32 | @UiThread 23 | @JsonProperty 23 | @ContainerPosition 16
 *   @JavascriptInterface 15 | @JsonDeserialize 11 | @Element 8
 *   @TypeConverter 4
 *
 * La grande majorite sont de VRAIS points d entree : un `@Subscribe` est
 * appele par le bus, un `@JavascriptInterface` par la page web, un
 * `@TypeConverter` par Room, un `@VisibleForTesting` par les tests. Leur corps
 * s execute pour de bon, donc les appels qu il contient sont de vrais appels,
 * et l ancre est legitime.
 *
 * Seuls les marqueurs de type ou de fil (`@Nullable` 58, `@NonNull` 32,
 * `@UiThread` 23, `@ContainerPosition` 16, soit 11 % des M6) ne disent rien
 * sur qui appelle. Sur ceux la, l ancre serait abusive.
 *
 * ## L ampleur n est pas mesuree, et voici pourquoi
 *
 * Deux tentatives, toutes deux ecartees. Blanchir le corps des membres M6 et
 * relancer le detecteur donne 62 bascules, ou 9 en se restreignant aux
 * marqueurs. Les trois premieres relues a la main sont des artefacts :
 * `explainMembers` n expose que la LIGNE du membre, pas son etendue, donc le
 * blanchiment va de la declaration jusqu au membre suivant et avale du code
 * qui ne lui appartient pas. `TextViewUtils.textViewIsTargetOfAlphaAnimation`
 * ressort ainsi comme mort alors que `PapyrusViewUtils` l appelle.
 *
 * Aucun cas reel n a donc ete confirme. Le nombre honnete est : inconnu,
 * probablement tres petit.
 *
 * ## Ce que ce fichier sert a faire
 *
 * Borner la regle. Le jour ou quelqu un corrigera G21 et G22, la tentation
 * sera d appliquer la meme relache ici. Les gardes ci dessous disent que ce
 * serait faux pour la plupart des annotations de M6, et les cas positifs
 * disent pour lesquelles ce serait juste. C est un filet de regression avant
 * le correctif, pas une trouvaille a recolter.
 */

const memb: any = await importOrNull('src/providers/unusedMembers');
const enums: any = await importOrNull('src/providers/unusedEnumEntries');
const res: any = await importOrNull('src/providers/UnusedResourceProvider');

const APP = '/w/app';
const f = (path: string, text: string) => ({ path, text });

const morts = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any) as any[])
    .map((m: any) => `${m.container}.${m.name}`);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (memb.explainMembers({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any) as any[])
    .find((m: any) => m.name === nom);

const VIVANT = f(`${APP}/src/main/java/com/x/Main.kt`, 'package com.x\n\nfun main() {\n    Holder().go()\n}\n');

/**
 * Le porteur. `ancre` est la ligne annotee, presente ou non selon le cas ;
 * `helper` n est appele que par elle.
 *
 * Forme reduite de
 *, ou
 * `onBusEvent` porte `@Subscribe` et appelle `isFirstOfEditionPage()`, seul
 * appelant de cette methode dans tout le corpus.
 */
const porteur = (annotation: string | null) => f(`${APP}/src/main/java/com/x/Holder.kt`, [
  'package com.x',
  '',
  'class Holder {',
  '',
  '    fun go() = 1',
  '',
  ...(annotation ? [`    ${annotation}`, '    fun anchor() { helper() }', ''] : []),
  '    fun helper() = 2',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!memb)('le detecteur juge bien ce corpus', () => {
  it('rapporte le voisin quand aucune ancre ne l appelle', () => {
    expect(morts(porteur(null), VIVANT)).toContain('Holder.helper');
  });

  it('et laisse tranquille le membre que le point d entree appelle', () => {
    expect(morts(porteur('@Inject'), VIVANT)).not.toContain('Holder.helper');
  });
});

// ── Sentinelles : le mecanisme, fixe par ecrit ─────────────────────────────

describe.skipIf(!memb)('aujourd hui, un membre ecarte tient son voisin en vie', () => {
  /**
   * Les deux lignes qui prouvent le mecanisme. Le meme voisin, le meme
   * fichier, la seule difference est la presence d une declaration que le
   * detecteur ne juge pas.
   */
  it('le voisin passe de unreferenced a selfOnly selon la presence de l ancre', () => {
    expect(verdict('helper', porteur(null), VIVANT)).toMatchObject({ outcome: 'unreferenced' });
    expect(verdict('helper', porteur('@Inject'), VIVANT)).toMatchObject({ outcome: 'selfOnly' });
  });

  it('et l ancre elle meme sort bien en M6', () => {
    expect(verdict('anchor', porteur('@Inject'), VIVANT)).toMatchObject({ outcome: 'M6:@Inject' });
  });

  /**
   * Le meme effet avec un pur marqueur de type, ou l argument « un cadre
   * l appelle peut etre » ne tient pas : `@Nullable` ne dit rien sur qui
   * appelle. C est le seul groupe d annotations ou la relache se justifierait.
   */
  it('un pur marqueur de type produit exactement le meme effet', () => {
    expect(verdict('anchor', porteur('@Nullable'), VIVANT)).toMatchObject({ outcome: 'M6:@Nullable' });
    expect(verdict('helper', porteur('@Nullable'), VIVANT)).toMatchObject({ outcome: 'selfOnly' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!memb)('la relache, la ou elle se justifie', () => {
  /**
   * `@Nullable` sur une methode ne la rend pas appelable par un cadre : c est
   * une annotation de TYPE, lue par les outils d analyse, jamais par un
   * appelant. Un voisin que seule une methode `@Nullable` morte appelle est
   * mort avec elle.
   */
  it.fails('un voisin que seule une methode @Nullable appelle devrait partir', () => {
    expect(morts(porteur('@Nullable'), VIVANT)).toContain('Holder.helper');
  });

  it.fails('idem pour @NonNull', () => {
    expect(morts(porteur('@NonNull'), VIVANT)).toContain('Holder.helper');
  });

  it.fails('idem pour @UiThread, qui parle du fil, pas de l appelant', () => {
    expect(morts(porteur('@UiThread'), VIVANT)).toContain('Holder.helper');
  });

  /**
   * Et l ancre elle meme, tant qu a faire : une methode `@Nullable` que
   * personne n appelle est aussi morte que si elle n etait pas annotee.
   */
  it.fails('et l ancre @Nullable elle meme devrait partir', () => {
    expect(morts(porteur('@Nullable'), VIVANT)).toContain('Holder.anchor');
  });
});

// ── Gardes : la frontiere, et c est le cœur de ce fichier ───────────────────

describe.skipIf(!memb)('les annotations pour lesquelles l ancre est legitime', () => {
  const temoin = () => expect(morts(porteur(null), VIVANT)).toContain('Holder.helper');

  /**
   * Le cas de reference, et le plus frequent du corpus apres `@Inject` :
   * `@Subscribe` est appele par le bus d evenements, donc son corps s execute
   * et ses appels sont de vrais appels.
   *
 * Motif reel: PageBecameAvailableHelper, `onBusEvent` annote
   * `@Subscribe`, seul appelant de `isFirstOfEditionPage()` dans tout le
   * corpus. Relacher ici supprimerait du code qui tourne.
   */
  it('@Subscribe, appele par le bus', () => {
    temoin();
    expect(morts(porteur('@Subscribe'), VIVANT)).not.toContain('Holder.helper');
  });

  it('@Inject, dont Dagger remplit le champ ou appelle la methode', () => {
    temoin();
    expect(morts(porteur('@Inject'), VIVANT)).not.toContain('Holder.helper');
  });

  it('@JavascriptInterface, appele depuis la page web', () => {
    temoin();
    expect(morts(porteur('@JavascriptInterface'), VIVANT)).not.toContain('Holder.helper');
  });

  it('@TypeConverter, appele par la couche de persistance', () => {
    temoin();
    expect(morts(porteur('@TypeConverter'), VIVANT)).not.toContain('Holder.helper');
  });

  /**
   * `@VisibleForTesting` dit explicitement que l appelant est ailleurs, dans
   * un source set que la famille ne compte pas comme une preuve de vie mais
   * qui execute bel et bien le corps.
   */
  it('@VisibleForTesting, dont l appelant est un test', () => {
    temoin();
    expect(morts(porteur('@VisibleForTesting'), VIVANT)).not.toContain('Holder.helper');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [porteur(null), VIVANT], testSourceSets: ['/src/test/'], includeSelfOnly: false };
    expect((memb.findUnusedMembers(entier) as any[]).length).toBeGreaterThan(0);
    expect(memb.findUnusedMembers({ ...entier, truncated: true })).toHaveLength(0);
  });
});

// ── Les deux familles qui ne souffrent PAS du defaut ────────────────────────

describe.skipIf(!enums)('les entrees d enum ne s ancrent pas entre elles', () => {
  const ENUM = f(`${APP}/src/main/java/com/x/Mode.kt`, [
    'package com.x',
    '',
    'enum class Mode {',
    '    A,',
    '    B,',
    '    C',
    '}',
    '',
  ].join('\n'));

  const entrees = (...sources: { path: string; text: string }[]) =>
    ((enums.scanEnums({ sources, testSourceSets: ['/src/test/'] } as any) as any).entries ?? [])
      .map((e: any) => e.name);

  it('une entree lue laisse ses voisines etre rapportees', () => {
    const lecteur = f(`${APP}/src/main/java/com/x/Reader.kt`, 'package com.x\n\nfun read() = Mode.A\n');
    expect(entrees(ENUM, lecteur, VIVANT).sort()).toEqual(['B', 'C']);
  });

  it('et sans lecteur, les trois sortent', () => {
    expect(entrees(ENUM, VIVANT).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe.skipIf(!res)('les ressources : la cascade defait l ancre a la ronde suivante', () => {
  const entree = (kind: string, name: string, path: string) => ({
    kind, name, variants: [{ path, moduleDir: APP }],
  });
  const LAYOUT = f(`${APP}/src/main/res/layout/dead_panel.xml`, [
    '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <ImageView android:src="@drawable/panel_icon" />',
    '</LinearLayout>',
    '',
  ].join('\n'));
  const ICONE = f(`${APP}/src/main/res/drawable/panel_icon.xml`, '<shape />\n');
  const scan = (sources: any[], entries: any[]) =>
    (res.findUnusedResources({
      sources, entries, modulesWithCode: [APP], libraryModules: [], includeDrawables: true,
    } as any) as any[]).map((r: any) => `${r.kind}/${r.name}`);

  const eL = entree('layout', 'dead_panel', LAYOUT.path);
  const eI = entree('drawable', 'panel_icon', ICONE.path);

  it('a la ronde 1, le layout mort tient son dessin en vie', () => {
    expect(scan([LAYOUT, ICONE, VIVANT], [eL, eI])).toEqual(['layout/dead_panel']);
  });

  /**
   * Et c est pour ca que ce n est pas un trou : la ronde suivante le rattrape.
   * La difference avec G21 est que rien, ici, n empeche le layout de PARTIR.
   */
  it('a la ronde 2, le layout parti, le dessin sort', () => {
    expect(scan([ICONE, VIVANT], [eI])).toEqual(['drawable/panel_icon']);
  });
});
