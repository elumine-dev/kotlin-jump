import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';
import { collecterUnePasse, Coupe } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G21 — une bibliotheque recopiee dans le projet, et oubliee.
 *
 * Instruit la premiere piste ouverte par G20 : « un filtre amont prive une
 * famille aval de son gibier, combien d autres ilots F7 cache-t-il ? ». La
 * reponse tient dans un dossier, et c est le cas de code mort le plus large
 * que ce dossier de tests ait mesure.
 *
 * ## Le cas reel
 *
 *   un dossier d utilitaires d un module meteo
 *
 * NEUF fichiers Java, environ 29 Ko, la bibliotheque StickyRecyclerHeaders
 * recopiee telle quelle :
 *
 * DimensionCalculator HeaderPositionCalculator
 * HeaderProvider HeaderRenderer
 * HeaderViewCache LinearLayoutOrientationProvider
 * OrientationProvider StickyRecyclerHeadersAdapter
 * StickyRecyclerHeadersDecoration
 *
 * Verifie un par un : AUCUN des neuf noms n apparait ailleurs que dans ce
 * dossier, ni en Kotlin, ni en Java, ni en XML. Le dossier entier est mort.
 *
 * Ce que l extension en dit aujourd hui, mesure faite sur les vrais fichiers :
 *
 *   explainSymbols   les sept ordinaires -> alive:main
 *                    les deux autres     -> F7:RecyclerView
 *   findDeadIslands  limite 8  -> 0 ilot
 *                    limite 64 -> 0 ilot
 *   circuit complet  0 ronde, 0 coupe, 9 fichiers intacts
 *
 * Pas une trouvaille. Pas une ronde. Rien.
 *
 * ## Deux causes empilees, chacune suffisante
 *
 * **Premiere cause, et c est la nouvelle : un membre F7 sert d ancre.**
 * `StickyRecyclerHeadersAdapter` et `StickyRecyclerHeadersDecoration`
 * prolongent `RecyclerView.Adapter` et `RecyclerView.ItemDecoration`, donc F7
 * les ecarte. Ecartees, elles ne sont plus des candidates de l ilot, mais
 * elles NOMMENT toujours les sept autres. Du point de vue de la famille des
 * ilots, le groupe a donc un citant exterieur bien vivant, et il n est pas
 * ferme. La mesure le prouve en retirant les deux fichiers :
 *
 *   les neuf ensemble     -> 0 ilot, meme a la limite 64
 *   les sept sans elles   -> 1 ilot de dix noms, a la limite 64
 *
 * **Seconde cause, deja connue : la taille.** Meme sans les deux ancres, l
 * ilot compte dix noms, et `collecterUnePasse` appelle `findDeadIslands` avec
 * `maxIslandSize: 8`. Il faut monter la limite pour le voir. C est G13, dont
 * la correction disait que la falaise etait a cinq classes portant un membre ;
 * ici sept classes et leurs membres la depassent largement.
 *
 * Chacune des deux suffirait a cacher le dossier. Les corriger separement ne
 * donnerait donc rien : c est leur conjonction qu il faut defaire.
 *
 * ## Ce que ces tests demandent
 *
 * Qu une declaration ecartee par un filtre cesse de compter comme un citant
 * VIVANT pour les autres familles. Un F7 n est pas prouve vivant, il est
 * seulement non juge ; le traiter comme une preuve de vie est une erreur de
 * categorie. La famille des ilots devrait pouvoir absorber ses membres F7
 * dans l ilot au lieu de les prendre pour son exterieur.
 */

const iles: any = await importOrNull('src/providers/deadIslands');
const symb: any = await importOrNull('src/providers/unusedSymbols');

const D = '/w/app/src/main/java/com/x/utils';
const f = (nom: string, texte: string) => ({ path: `${D}/${nom}`, text: texte });

const ilots = (sources: { path: string; text: string }[], maxIslandSize = 8) =>
  (iles.findDeadIslands({ sources, testSourceSets: ['/src/test/'], maxIslandSize }) as any[])
    .map((x: any) => (x.names ?? [x.name]).join('+'));

const pourquoi = (nom: string, sources: { path: string; text: string }[]) =>
  (symb.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[]).find(s => s.name === nom);

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** app/.../live/weather/utils/StickyRecyclerHeadersAdapter.java:11 */
const ADAPTATEUR = f('StickyRecyclerHeadersAdapter.java', [
  'package com.x.utils;',
  '',
  'public abstract class StickyRecyclerHeadersAdapter extends RecyclerView.Adapter {',
  '',
  '\tpublic abstract long getHeaderId(int position);',
  '}',
  '',
].join('\n'));

/** app/.../live/weather/utils/StickyRecyclerHeadersDecoration.java:15 */
const DECORATION = f('StickyRecyclerHeadersDecoration.java', [
  'package com.x.utils;',
  '',
  'public class StickyRecyclerHeadersDecoration extends RecyclerView.ItemDecoration {',
  '',
  '\tprivate final HeaderViewCache cache;',
  '',
  '\tpublic StickyRecyclerHeadersDecoration(StickyRecyclerHeadersAdapter adapter) {',
  '\t\tthis.cache = new HeaderViewCache(adapter, new LinearLayoutOrientationProvider());',
  '\t}',
  '}',
  '',
].join('\n'));

/** app/.../live/weather/utils/HeaderViewCache.java:17 */
const CACHE = f('HeaderViewCache.java', [
  'package com.x.utils;',
  '',
  'public class HeaderViewCache implements HeaderProvider {',
  '',
  '\tHeaderViewCache(StickyRecyclerHeadersAdapter a, OrientationProvider p) { }',
  '',
  '\tpublic View getHeader(int position) { return null; }',
  '}',
  '',
].join('\n'));

/** app/.../live/weather/utils/HeaderProvider.java:14 */
const FOURNISSEUR = f('HeaderProvider.java', [
  'package com.x.utils;',
  '',
  'public interface HeaderProvider {',
  '',
  '\tView getHeader(int position);',
  '}',
  '',
].join('\n'));

/** app/.../live/weather/utils/OrientationProvider.java:12 */
const ORIENTATION = f('OrientationProvider.java', [
  'package com.x.utils;',
  '',
  'public interface OrientationProvider {',
  '',
  '\tint getOrientation();',
  '}',
  '',
].join('\n'));

/** app/.../live/weather/utils/LinearLayoutOrientationProvider.java:13 */
const LINEAIRE = f('LinearLayoutOrientationProvider.java', [
  'package com.x.utils;',
  '',
  'public class LinearLayoutOrientationProvider implements OrientationProvider {',
  '',
  '\tpublic int getOrientation() { return 1; }',
  '}',
  '',
].join('\n'));

const VIVANT = { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nfun main() {\n    println(1)\n}\n' };

/** Les sept ordinaires : le dossier sans ses deux classes de RecyclerView. */
const SANS_ANCRES = [CACHE, FOURNISSEUR, ORIENTATION, LINEAIRE, VIVANT];

/** Le dossier entier, comme il est sur le disque. */
const DOSSIER = [ADAPTATEUR, DECORATION, ...SANS_ANCRES];

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!iles)('la famille des ilots sait voir ce groupe', () => {
  /**
   * Sans les deux ancres, le groupe est un ilot de manuel et la famille le
   * rapporte, a la limite par defaut. C est ce qui rend la suite lisible :
   * ce n est pas la FORME qui lui echappe, c est ce qui l entoure.
   */
  it('le rapporte des que les deux membres F7 ne sont plus la', () => {
    const vus = ilots(SANS_ANCRES);
    expect(vus).toHaveLength(1);
    expect(vus[0]).toContain('HeaderViewCache');
    expect(vus[0]).toContain('LinearLayoutOrientationProvider');
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!iles)('deux membres ecartes ne cachent plus le dossier', () => {
  it('le dossier entier est un ilot', () => {
    expect(ilots(DOSSIER)).toHaveLength(1);
  });

  /**
   * La taille etait la SECONDE cause, et elle ne mord plus : les deux ancres
   * absorbees, l ilot tient sous la limite par defaut comme a soixante quatre.
   */
  it('a la limite par defaut comme a soixante quatre', () => {
    expect(ilots(DOSSIER, 64)).toHaveLength(1);
  });

  it('alors que sans elles, la limite par defaut suffit', () => {
    expect(ilots(SANS_ANCRES)).toHaveLength(1);
  });

  /**
   * Les deux ancres ne sortent MEME PLUS en F7 : KJ-080 a retire les vues du
   * filtre, `RecyclerView` compris, parce que la balise XML qui les instancie
   * n est pas invisible a ce scanner. Elles sont desormais jugees, et jugees
   * mortes, ce qui est la reponse que G20 et G21 demandaient chacun de son
   * cote.
   */
  it('les deux ancres ne sont plus ecartees du tout, elles sont JUGEES', () => {
    // L une est nommee par ses voisines du dossier, l autre par personne. Les
    // deux sont desormais jugees, et c est tout ce que la regle demandait :
    // une declaration ecartee n est pas une declaration prouvee vivante.
    expect(pourquoi('StickyRecyclerHeadersAdapter', DOSSIER)).toMatchObject({ outcome: 'alive:main' });
    expect(pourquoi('StickyRecyclerHeadersDecoration', DOSSIER)).toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * Le cœur du malentendu, laisse par ecrit : chez les SYMBOLES, les sept
   * ordinaires passent toujours de `alive:main` a `unreferenced` selon que les
   * deux ancres sont la ou non. Leur vie y tient encore a deux declarations que
   * personne n a jugees, et c est pourquoi la correction est du cote des ilots :
   * c est la famille qui sait ancrer par le manifeste et les layouts.
   */
  it('chez les symboles, leur vie tient encore aux deux ancres', () => {
    expect(pourquoi('HeaderViewCache', DOSSIER)).toMatchObject({ outcome: 'alive:main' });
    expect(pourquoi('HeaderViewCache', SANS_ANCRES)).toMatchObject({ outcome: 'unreferenced' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!iles)('un dossier entier que rien ne nomme devrait etre rapporte', () => {
  it('la famille des ilots le voit malgre ses deux membres F7', () => {
    expect(ilots(DOSSIER)).toHaveLength(1);
  });

  it('et l ilot contient les deux membres F7, il ne les exclut pas', () => {
    expect(ilots(DOSSIER, 64).join(' ')).toContain('StickyRecyclerHeadersDecoration');
  });

  /**
   * Le circuit complet ne bouge pas non plus : ni la famille des symboles, ni
   * celle des membres, ni celle des ilots ne prend ce dossier. Mesure faite
   * sur les neuf VRAIS fichiers : zero ronde, zero coupe.
   */
  it('le circuit complet finit par vider le dossier', () => {
    let courant = [...DOSSIER];
    let rondes = 0;
    for (let i = 0; i < 16; i++) {
      const r = collecterUnePasse(courant, ['/src/test/']);
      const combien = [...r.parFichier.values()].reduce((a, v) => a + v.length, 0) + r.fichiersMorts.size;
      if (combien === 0) break;
      rondes++;
      const morts = r.fichiersMorts;
      courant = courant.filter(s => !morts.has(s.path)).map(s => {
        const c = r.parFichier.get(s.path);
        if (!c || !c.length) return s;
        let t = s.text;
        for (const k of [...c].sort((a: Coupe, b: Coupe) => b.start - a.start)) {
          t = t.slice(0, k.start) + k.texte + t.slice(k.end);
        }
        return { path: s.path, text: t };
      });
    }
    expect(rondes).toBeGreaterThan(0);
    expect(courant.map(s => s.path)).toEqual([VIVANT.path]);
  });

  it('et la premiere ronde coupe deja', () => {
    const r = collecterUnePasse(DOSSIER, ['/src/test/']);
    const combien = [...r.parFichier.values()].reduce((a, v) => a + v.length, 0) + r.fichiersMorts.size;
    expect(combien).toBeGreaterThan(0);
  });
});

// ── Gardes : ce qui ne doit PAS etre rapporte ───────────────────────────────

describe.skipIf(!iles)('ce que la relache ne doit pas emporter', () => {
  /**
   * Le canari de ce fichier est le groupe lui meme, vu sans ses ancres : les
   * gardes ci dessous le font disparaitre en ajoutant UN citant exterieur, et
   * le contraste prouve que l appel juge bien le corpus.
   */
  const temoin = () => expect(ilots(SANS_ANCRES)).toHaveLength(1);

  /**
   * Nuance mesuree en ecrivant ce test, et qui corrige ce que j attendais :
   * nommer UN membre ne sauve pas le groupe entier, il sauve ce membre. Le
   * reste peut rester un ilot, plus petit, et c est juste. La garde porte
   * donc sur le membre nomme, jamais sur ses voisins.
   */
  it('le membre qu un appelant VIVANT nomme sort de l ilot', () => {
    temoin();
    const appelant = {
      path: '/w/app/src/main/java/com/x/Weather.java',
      text: [
        'package com.x;',
        '',
        'import com.x.utils.HeaderViewCache;',
        '',
        'public class Weather {',
        '',
        '\tpublic void setup() {',
        '\t\tnew HeaderViewCache(null, null);',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    // L appelant doit lui meme etre vivant : un appelant mort rejoint l ilot
    // au lieu de le sauver, et c est juste. Mesure faite en ecrivant ce test.
    const entree = {
      path: '/w/app/src/main/java/com/x/Main.kt',
      text: 'package com.x\n\nfun main() {\n    Weather().setup()\n}\n',
    };
    const sources = [...SANS_ANCRES.filter(s => s.path !== VIVANT.path), appelant, entree];
    const vus = ilots(sources).join(' ');
    expect(vus).not.toContain('HeaderViewCache');
  });

  /**
   * Une ancre F7 REELLEMENT construite quelque part garde tout le groupe, et
   * c est le cas ordinaire de la bibliotheque encore utilisee. La relache ne
   * doit donc pas se contenter de retirer les F7 du calcul : absorbee dans le
   * bassin, l ancre reste atteignable par son constructeur et tient le groupe.
   *
   * La fixture porte son entree : sans elle, `Weather` est morte et rejoint l
   * ilot au lieu de le sauver. C est la meme nuance que la garde precedente,
   * et elle manquait ici. Ecrite avant la relache, cette garde passait pour
   * une raison qui n etait pas la sienne : l ancre etait hors du bassin, donc
   * rien de ce qui la nommait ne comptait.
   */
  it('une ancre que quelqu un construit garde le groupe entier', () => {
    const appelant = {
      path: '/w/app/src/main/java/com/x/Weather.java',
      text: [
        'package com.x;',
        '',
        'import com.x.utils.StickyRecyclerHeadersDecoration;',
        '',
        'public class Weather {',
        '',
        '\tpublic void setup() {',
        '\t\tlist.addItemDecoration(new StickyRecyclerHeadersDecoration(adapter));',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    const entree = {
      path: '/w/app/src/main/java/com/x/Main.kt',
      text: 'package com.x\n\nfun main() {\n    Weather().setup()\n}\n',
    };
    expect(ilots([...DOSSIER.filter(s => s.path !== VIVANT.path), appelant, entree])).toEqual([]);
  });

  /**
   * Et la contrepartie, qui est le cœur de G21 : la MEME ancre, le MEME
   * constructeur, mais un `Weather` que plus personne n appelle. Tout le
   * groupe est alors mort, ancre comprise, et doit etre rapporte.
   */
  it('mais une ancre dont le constructeur est mort ne sauve rien', () => {
    const appelantMort = {
      path: '/w/app/src/main/java/com/x/Weather.java',
      text: [
        'package com.x;',
        '',
        'import com.x.utils.StickyRecyclerHeadersDecoration;',
        '',
        'public class Weather {',
        '',
        '\tpublic void setup() {',
        '\t\tlist.addItemDecoration(new StickyRecyclerHeadersDecoration(adapter));',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    expect(ilots([...DOSSIER, appelantMort], 64).join(' ')).toContain('StickyRecyclerHeadersDecoration');
  });

  it('le membre qu un layout nomme sort de l ilot', () => {
    temoin();
    const layout = {
      path: '/w/app/src/main/res/layout/weather.xml',
      text: [
        '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">',
        '    <com.x.utils.LinearLayoutOrientationProvider />',
        '</LinearLayout>',
        '',
      ].join('\n'),
    };
    const vus = ilots([...SANS_ANCRES, layout]).join(' ');
    expect(vus).not.toContain('LinearLayoutOrientationProvider');
  });

  it('un membre nomme par un test seulement n est pas un ilot ordinaire', () => {
    temoin();
    const test = {
      path: '/w/app/src/test/java/com/x/HeaderViewCacheTest.java',
      text: [
        'package com.x;',
        '',
        'public class HeaderViewCacheTest {',
        '',
        '\tvoid t() { new HeaderViewCache(null, null); }',
        '}',
        '',
      ].join('\n'),
    };
    const vus = ilots([...SANS_ANCRES, test]);
    expect(vus.join(' ')).not.toContain('HeaderViewCacheTest');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    expect(ilots(SANS_ANCRES)).toHaveLength(1);
    expect(iles.findDeadIslands({
      sources: SANS_ANCRES, testSourceSets: ['/src/test/'], maxIslandSize: 8, truncated: true,
    })).toHaveLength(0);
  });
});
