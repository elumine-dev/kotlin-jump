import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G28 — un filtre avale le verdict au lieu de le doubler.
 *
 * Dernier tour du recensement. F6 etait le seul filtre dont la sur largeur n
 * avait pas ete mesuree ; il est legitime. Le recensement est donc complet, et
 * ce fichier le fixe en tests, plus l outil qui manquait pour le mener.
 *
 * ## Le recensement complet de `unusedSymbols`
 *
 * Sur 7875 declarations du corpus de reference :
 *
 *   alive        4493   un verdict
 *   F1 private   1627   delegue au balayage, verifie en G24
 *   F3 duplicate  748   trois sur largeurs, G24, G25 et G26
 *   F5 annotation 438   ancre ses voisins, G22
 *   F7 supertype  290   ancre ses voisins et aveugle les vues, G20 et G21
 *   F8 sous type   93   cautionne par une declaration non jugee, G27
 *   F12 ignore     74   intention explicite de l auteur, hors sujet
 *   F6 reflectif   56   LEGITIME, mesure ci dessous
 *   unreferenced   34   un verdict
 *   testOnly       15   un verdict
 *
 * ## F6 : mesure, et verdict de legitimite
 *
 * 56 declarations, `Serializable` 34 et `Parcelable` 22. Une sous classe d une
 * classe serialisable est serialisable a son tour, et la desserialisation la
 * fabrique par son nom sans que le corpus le nomme : la marche de huit
 * ancetres est donc justifiee. Et sur le corpus, **aucune** des 56 n est
 * ignoree par tous les autres fichiers de production. F6 ne cache rien.
 *
 * Une sonde a bien annonce « 27 sur 56 par un ancetre, sans clause directe »,
 * ce qui aurait ete un defaut de parseur. C etait un artefact : la sonde ne
 * lisait que deux lignes, et `ViewSpacing`
 * porte son
 * `: Serializable` huit lignes plus bas, apres ses parametres. Verifie a la
 * main sur trois cas, tous directs.
 *
 * ## Ce qui manque vraiment, et qui a coute huit tours
 *
 * `explainSymbols` rend UN champ `outcome`. Quand un filtre s applique, il
 * ecrase le verdict que le comptage aurait donne (unusedSymbols.ts:1709-1711,
 * `if (rejected) outcome = rejected;`). On ne sait donc jamais si une
 * declaration ecartee EST vivante ou seulement non jugee.
 *
 * Cette absence a coute cher a ce dossier. Chaque trou de G20 a G27 a demande
 * une SIMULATION pour repondre : retirer les fichiers F7 du corpus, renommer
 * les homonymes prives, blanchir les corps M6. Trois de ces simulations ont
 * rendu des chiffres faux, et il a fallu les relire a la main pour s en
 * apercevoir.
 *
 * Deux champs regleraient tout cela : le verdict qu aurait donne le comptage,
 * et de quoi le recalculer. `mainMentions` seul ne suffit pas, il faut savoir
 * combien de ces mentions viennent du fichier declarant.
 *
 * ## Ce que ces tests demandent
 *
 * Que `explainSymbols` double le filtre d un verdict, au lieu de l avaler. Le
 * reste du fichier est le recensement lui meme : un test par filtre, sur son
 * motif reel, pour qu une modification du jeu de filtres se signale ici.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const VIVANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources: [...sources, VIVANT], testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom);

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources: [...sources, VIVANT], testSourceSets: ['/src/test/'] } as any) as any[])
    .map(s => s.name);

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!mod)('sans filtre, le comptage decide', () => {
  it('une declaration que rien ne nomme est rapportee', () => {
    expect(verdict('Orpheline', f('Orpheline.kt', 'package com.x\n\nclass Orpheline\n')))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  it('et une declaration que quelqu un nomme est vivante', () => {
    const decl = f('Vivante.kt', 'package com.x\n\nclass Vivante\n');
    const usage = f('Usage.kt', 'package com.x\n\nfun go() = Vivante()\n');
    expect(verdict('Vivante', decl, usage)).toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Le recensement : un test par filtre, sur son motif reel ────────────────

describe.skipIf(!mod)('chaque filtre, sur le motif qui le declenche', () => {
  /** 1627 declarations. Deleguees au balayage, verifie en G24. */
  it('F1, une declaration privee de premier niveau', () => {
    expect(verdict('Priv', f('Priv.kt', 'package com.x\n\nprivate class Priv\n')))
      .toMatchObject({ outcome: 'F1:private' });
  });

  /** 748 declarations. Trois sur largeurs, G24, G25, G26. */
  it('F3, un nom porte par deux declarations de premier niveau', () => {
    const a = f('A.kt', 'package com.x\n\nclass Dup\n');
    const b = f('B.kt', 'package com.x\n\nclass Dup\n');
    const usage = f('C.kt', 'package com.x\n\nfun go() = Dup()\n');
    expect(verdict('Dup', a, b, usage)).toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  it('F4, une declaration multiplateforme', () => {
    expect(verdict('Kmp', f('Kmp.kt', 'package com.x\n\nexpect class Kmp\n')))
      .toMatchObject({ outcome: 'F4:kmp' });
  });

  /**
   * 438 declarations. Le motif reel est
 *, `@ScopeActivity`
   * sur une classe a constructeur `@Inject`. Voir G22 pour l effet d ancre.
   */
  it('F5, une declaration portant une annotation non benigne', () => {
    expect(verdict('Anno', f('Anno.kt', 'package com.x\n\n@ScopeActivity\nclass Anno\n')))
      .toMatchObject({ outcome: 'F5:@ScopeActivity' });
  });

  /**
   * 56 declarations, et le seul filtre que le recensement declare legitime.
 * Motif reel:,
   * `data class ViewSpacing(...) : Serializable`.
   */
  it('F6, une classe serialisable', () => {
    expect(verdict('ViewSpacing', f('ViewSpacing.kt', 'package com.x\n\nclass ViewSpacing : Serializable\n')))
      .toMatchObject({ outcome: 'F6:Serializable' });
  });

  it('F6, une classe Parcelable', () => {
    expect(verdict('Par', f('Par.kt', 'package com.x\n\nclass Par : Parcelable\n')))
      .toMatchObject({ outcome: 'F6:Parcelable' });
  });

  /**
   * 290 declarations. L exemple etait `OverlayView : View`, et KJ-080 a retire
   * les VUES de F7 : ce scanner lit le XML, donc la balise qui les instancie
   * n est pas invisible. Le filtre garde ce dont le contrat d instanciation
   * passe par un nom que le corpus ne contient pas forcement.
   */
  it('F7, une classe qui prolonge un type de cadre', () => {
    expect(verdict('Ecran', f('Ecran.kt', 'package com.x\n\nclass Ecran : Fragment\n')))
      .toMatchObject({ outcome: 'F7:Fragment' });
  });

  /** Et une VUE n y est plus : elle redescend dans le comptage ordinaire. */
  it('mais plus une vue, que la balise XML rendrait visible', () => {
    expect(verdict('OverlayView', f('OverlayView.kt', 'package com.x\n\nclass OverlayView : View\n')))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * 93 declarations. Motif reel :
 *. Voir G27.
   */
  it('F8, un parent dont un sous type est annote', () => {
    const parent = f('Parent.kt', 'package com.x\n\nopen class Parent\n');
    const sous = f('Sous.kt', 'package com.x\n\n@Serializable\nclass Sous : Parent()\n');
    expect(verdict('Parent', parent, sous)).toMatchObject({ outcome: 'F8:annotated-subtype' });
  });

  it('F10, une fonction operateur', () => {
    expect(verdict('plus', f('Op.kt', 'package com.x\n\noperator fun plus(a: Int) = a\n')))
      .toMatchObject({ outcome: 'F10:operator' });
  });

  /**
   * Un nom entre accents graves n est pas un identifiant, donc la recolte de
   * mentions ne peut pas le chercher : aucune absence n y est prouvable.
   */
  it('F11, un nom entre accents graves', () => {
    expect(verdict('a ghost', f('Ghost.kt', 'package com.x\n\nfun `a ghost`() = 1\n')))
      .toMatchObject({ outcome: 'F11:backtick-name' });
  });

  /** 74 declarations, et c est l intention explicite de l auteur. */
  it('F12, une declaration qui se retire elle meme', () => {
    expect(verdict('Sup', f('Sup.kt', 'package com.x\n\n@Suppress("unused")\nclass Sup\n')))
      .toMatchObject({ outcome: 'F12:suppress-unused' });
  });
});

// ── Sentinelles : ce que le filtre avale ────────────────────────────────────

describe.skipIf(!mod)('aujourd hui, le filtre ecrase le verdict du comptage', () => {
  const IFACE = f('AudioRepository.kt', 'package com.x\n\ninterface AudioRepository {\n\n    fun load(): Int\n}\n');
  const IMPL = f('Noop.kt', 'package com.x\n\n@Serializable\nclass Noop : AudioRepository {\n\n    override fun load() = 0\n}\n');
  const CONSO = f('Player.kt', 'package com.x\n\nclass Player(private val r: AudioRepository) {\n\n    fun go() = r.load()\n}\n');

  it('le meme outcome, que le type soit consomme ou non', () => {
    expect(verdict('AudioRepository', IFACE, IMPL)).toMatchObject({ outcome: 'F8:annotated-subtype' });
    expect(verdict('AudioRepository', IFACE, IMPL, CONSO)).toMatchObject({ outcome: 'F8:annotated-subtype' });
  });

  /**
   * CORRIGÉ. `mainMentions` bouge avec le corpus, et il compte aussi les
   * mentions du fichier déclarant ; `selfInFile` dit désormais combien, donc
   * le verdict se reconstruit de l'extérieur. Et `wouldBe` le donne tout fait.
   */
  it('le compte bouge, et selfInFile dit ce qu il faut en retirer', () => {
    const sans = verdict('AudioRepository', IFACE, IMPL);
    const avec = verdict('AudioRepository', IFACE, IMPL, CONSO);
    expect(avec.mainMentions).toBeGreaterThan(sans.mainMentions);
    expect(avec.selfInFile).toBeGreaterThan(0);
    expect(avec.wouldBe).toBe('alive:main');
  });
});

// ── Ce que le detecteur devrait rendre ──────────────────────────────────────

describe.skipIf(!mod)('un filtre devrait doubler le verdict, pas l avaler', () => {
  const IFACE = f('AudioRepository.kt', 'package com.x\n\ninterface AudioRepository {\n\n    fun load(): Int\n}\n');
  const IMPL = f('Noop.kt', 'package com.x\n\n@Serializable\nclass Noop : AudioRepository {\n\n    override fun load() = 0\n}\n');
  const CONSO = f('Player.kt', 'package com.x\n\nclass Player(private val r: AudioRepository) {\n\n    fun go() = r.load()\n}\n');

  it('une declaration ecartee dit ce que le comptage aurait donne', () => {
    expect(verdict('AudioRepository', IFACE, IMPL, CONSO)).toHaveProperty('wouldBe');
  });

  it('et ce verdict distingue une vivante d une non jugee', () => {
    expect(verdict('AudioRepository', IFACE, IMPL, CONSO)).toMatchObject({ wouldBe: 'alive:main' });
    expect(verdict('AudioRepository', IFACE, IMPL)).toMatchObject({ wouldBe: 'alive:main' });
  });

  /**
   * A defaut, le nombre de mentions du fichier declarant suffirait a
   * reconstruire le verdict sans simulation.
   */
  it('et les mentions du fichier declarant sont exposees aussi', () => {
    expect(verdict('AudioRepository', IFACE, IMPL, CONSO)).toHaveProperty('selfInFile');
  });
});

// ── Gardes : le recensement ne doit pas se defaire ─────────────────────────

describe.skipIf(!mod)('ce qu un doublement du verdict ne doit pas changer', () => {
  /**
   * La garde centrale. Doubler le verdict est un changement de RAPPORT, pas de
   * decision : aucune declaration ecartee ne doit se mettre a etre supprimee
   * parce qu on sait desormais ce que le comptage en pensait.
   */
  it('aucun filtre ne doit se mettre a produire une coupe', () => {
    const cas: [string, { path: string; text: string }[]][] = [
      ['Priv', [f('Priv.kt', 'package com.x\n\nprivate class Priv\n')]],
      ['Kmp', [f('Kmp.kt', 'package com.x\n\nexpect class Kmp\n')]],
      ['Anno', [f('Anno.kt', 'package com.x\n\n@ScopeActivity\nclass Anno\n')]],
      ['ViewSpacing', [f('ViewSpacing.kt', 'package com.x\n\nclass ViewSpacing : Serializable\n')]],
      ['Par', [f('Par.kt', 'package com.x\n\nclass Par : Parcelable\n')]],
      // `OverlayView : View` etait ici. KJ-080 l a retiree de F7 : ce scanner
      // lit le XML, donc rien d invisible ne protege plus une vue. C est un
      // Fragment qui tient sa place, dont le contrat d instanciation passe par
      // un nom range dans un Bundle.
      ['Ecran', [f('Ecran.kt', 'package com.x\n\nclass Ecran : Fragment\n')]],
      ['Sup', [f('Sup.kt', 'package com.x\n\n@Suppress("unused")\nclass Sup\n')]],
    ];
    for (const [nom, sources] of cas) {
      expect(morts(...sources), `${nom} ne doit pas etre rapportee`).not.toContain(nom);
    }
  });

  /**
   * Et F6 en particulier, puisque c est le filtre que le recensement declare
   * legitime : une sous classe herite de l exemption, parce qu elle herite de
   * la serialisabilite.
   */
  it('une sous classe d une classe serialisable reste exemptee', () => {
    const base = f('Base.kt', 'package com.x\n\nopen class Base : Serializable\n');
    const sous = f('Sous.kt', 'package com.x\n\nclass Sous : Base()\n');
    expect(verdict('Sous', base, sous)).toMatchObject({ outcome: 'F6:Serializable' });
    expect(morts(base, sous)).not.toContain('Sous');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = {
      sources: [f('Orpheline.kt', 'package com.x\n\nclass Orpheline\n'), VIVANT],
      testSourceSets: ['/src/test/'],
    };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
