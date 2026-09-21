import { describe, it, expect } from 'vitest';
import { collecterUnePasse, Coupe } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Le circuit complet, et ce qui lui survit quand meme.
 *
 * Les dix sept autres fichiers de ce dossier interrogent UN detecteur. La
 * commande, elle, les enchaine et recommence jusqu au point fixe, seize
 * rondes au plus (`PASSES_MAX`, RemoveEverythingUnused). Une coupe
 * orpheline la suivante, et une famille rattrape ce qu une autre a manque.
 *
 * Deux consequences, et les deux comptent :
 *
 *  1. Un trou mesure sur un detecteur seul n est pas forcement un trou pour
 *     l utilisateur. Le circuit peut le refermer a la ronde suivante.
 *  2. Un trou qui survit au circuit entier est le seul dont on puisse dire
 *     qu il laisse du code mort sur le disque.
 *
 * Ce fichier mesure la difference. Il a deja servi : il a corrige G13.
 *
 * ## La correction que ce fichier apporte a G13
 *
 * G13 mesure la limite de `findDeadIslands` (`maxIslandSize: 8`) sur une
 * CHAINE de classes sans membre, et conclut qu un ilot de neuf disparait en
 * silence. Les deux moities de cette phrase sont fausses au niveau du
 * circuit, dans des sens opposes :
 *
 *   chaine de  9 classes  -> entierement retiree, en sept rondes
 *   chaine de 20 classes  -> entierement retiree, et la commande DIT qu elle
 *                            s arrete au plafond si elle y arrive
 *   cycle  de 12 classes  -> entierement retire, en trois rondes
 *
 * Une chaine se defait par un bout : la premiere classe n est nommee par
 * personne, la famille des symboles la coupe, la suivante devient orpheline.
 * Un cycle sans membre lu se defait par le milieu : la famille des membres
 * coupe les methodes que personne ne lit, ce qui casse le cycle.
 *
 * Ce qui survit vraiment est plus etroit, et personne ne l avait ecrit :
 *
 *   cycle de 4 classes, chaque methode lue par la voisine -> retire
 *   cycle de 5 classes, idem                              -> INTACT
 *
 * La limite annoncee a huit compte les DECLARATIONS, membres compris. Une
 * classe qui porte une methode en vaut deux. La falaise tombe donc a cinq
 * classes, pas a neuf, et sur du vrai code, ou une classe porte cinq ou six
 * membres, elle tombe a deux.
 *
 * ## Ce que le circuit ne rattrape pas
 *
 * G2, G4 et G12 survivent au circuit entier : aucune ronde n y touche. Ce
 * sont les trous dont le cout se mesure en fichiers laisses sur le disque.
 * G12 est le plus instructif : le circuit VIDE la classe imbriquee de son
 * seul champ, puis laisse la coquille. Attention en le lisant : l enum vide
 * de `DatabaseService` n est PAS un cas de G12, il est deja couvert par
 * `scanEnums`. Le fixture prend donc la classe imbriquee, seule forme que
 * personne ne juge entiere.
 */

type Source = { path: string; text: string };

const MAIN = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });

/**
 * Une passe applique ses coupes en remontant : une coupe deplace tout ce qui
 * la suit, et les appliquer dans l ordre decalerait les suivantes.
 */
function appliquer(
  sources: readonly Source[],
  parFichier: ReadonlyMap<string, Coupe[]>,
  morts: ReadonlySet<string>,
): Source[] {
  const restant: Source[] = [];
  for (const s of sources) {
    if (morts.has(s.path)) continue;
    const coupes = parFichier.get(s.path);
    if (!coupes || coupes.length === 0) { restant.push(s); continue; }
    let t = s.text;
    for (const c of [...coupes].sort((a, b) => b.start - a.start)) {
      t = t.slice(0, c.start) + c.texte + t.slice(c.end);
    }
    restant.push({ path: s.path, text: t });
  }
  return restant;
}

/**
 * Le point fixe, comme la commande le fait : collecter, appliquer, recommencer
 * tant qu une ronde trouve quelque chose. Seize au plus, le meme plafond.
 */
function circuit(sources: readonly Source[]) {
  let courant = [...sources];
  const coupes: string[] = [];
  let rondes = 0;
  for (let i = 0; i < 16; i++) {
    const r = collecterUnePasse(courant, ['/src/test/']);
    const combien = [...r.parFichier.values()].reduce((a, v) => a + v.length, 0) + r.fichiersMorts.size;
    if (combien === 0) break;
    rondes++;
    for (const v of r.parFichier.values()) for (const c of v) coupes.push(`${c.famille}:${c.quoi}`);
    for (const p of r.fichiersMorts) coupes.push(`fichiers:${p.split('/').pop()}`);
    courant = appliquer(courant, r.parFichier, r.fichiersMorts);
  }
  return {
    rondes,
    coupes,
    /** Les fichiers encore sur le disque a la fin. */
    fichiers: courant.map(s => s.path.split('/').pop()!),
    /** Le texte final d un fichier, pour regarder ce qui reste dedans. */
    texte: (nom: string) => courant.find(s => s.path.endsWith('/' + nom))?.text ?? '',
  };
}

const aCoupe = (r: ReturnType<typeof circuit>, quoi: string) =>
  r.coupes.some(c => c.endsWith(':' + quoi));

/** Une classe morte de facon evidente, que le circuit doit couper. */
const CANARI = f('CanaryGone.kt', 'package com.x\n\nclass CanaryGone\n');

/** Un point d entree vivant, pour que le corpus ne soit pas mort en entier. */
const VIVANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

/**
 * Une garde n a de valeur que si le circuit JUGE le corpus. Sans canari, « il
 * n a pas coupe la cible » est vrai aussi quand il n a rien coupe du tout.
 */
const epargne = (r: ReturnType<typeof circuit>, cible: string) => {
  expect(r.coupes).toContain('symboles:CanaryGone');
  expect(aCoupe(r, cible)).toBe(false);
};

/** Une chaine : chacune nomme la suivante, personne ne nomme la premiere. */
const chaine = (n: number) => Array.from({ length: n }, (_, i) =>
  f(`Z${i}.kt`, `package com.x\n\nclass Z${i} {\n    fun go() = ${i === n - 1 ? '1' : `Z${i + 1}()`}\n}\n`));

/** Un cycle dont les methodes ne sont PAS lues : chacune construit la voisine. */
const cycleMuet = (n: number) => Array.from({ length: n }, (_, i) =>
  f(`Y${i}.kt`, `package com.x\n\nclass Y${i} {\n    fun go() = Y${(i + 1) % n}()\n}\n`));

/**
 * Un cycle dont chaque methode EST lue par la voisine. C est la forme d un
 * sous systeme abandonne en bloc : tout s y tient, et rien ne le nomme du
 * dehors. C est aussi la seule que le circuit ne sait pas defaire.
 */
const cycleLu = (n: number) => Array.from({ length: n }, (_, i) =>
  f(`W${i}.kt`, `package com.x\n\nclass W${i} {\n    fun go(): Int = W${(i + 1) % n}().go()\n}\n`));

// ── Fixtures reduites du motif reel ─────────────────────────────────────────

/**
 * G4, reduit. Cas reel : `ShellMainLayout`
 *, implementee par
 * `AppMainLayout` et
 * fournie par `AppMainActivityModule`
 * Rien n injecte le type : l abstraction est morte, l implementation vit.
 */
const G4 = [
  f('ShellMainLayout.java', [
    'package com.x;',
    '',
    'public interface ShellMainLayout {',
    '',
    '\tvoid show();',
    '}',
    '',
  ].join('\n')),
  f('AppMainLayout.java', [
    'package com.x;',
    '',
    'public class AppMainLayout implements ShellMainLayout {',
    '',
    '\tpublic void show() {}',
    '}',
    '',
  ].join('\n')),
  f('AppMainActivityModule.java', [
    'package com.x;',
    '',
    'import dagger.Module;',
    'import dagger.Provides;',
    '',
    '@Module',
    'public class AppMainActivityModule {',
    '',
    '\t@Provides',
    '\tShellMainLayout provideShellMainLayout(AppMainLayout l) {',
    '\t\treturn l;',
    '\t}',
    '}',
    '',
  ].join('\n')),
  f('Main.kt', 'package com.x\n\nfun main() {\n    println(AppMainLayout().show())\n}\n'),
];

/**
 * G2, reduit. Cas reel : `MainActivityV2Module`, un `@Module` qu aucun
 * `includes = [...]` ne nomme
 *. Le vrai
 * etend `BaseModule()` et prend une `Activity` ; ni l un ni l autre ne change
 * ce que le circuit en fait, le fixture s en passe.
 */
const G2 = [
  f('MainActivityV2Module.kt', [
    'package com.x',
    '',
    'import dagger.Module',
    'import dagger.Provides',
    '',
    '@Module',
    'class MainActivityV2Module {',
    '',
    '    @Provides',
    '    fun provideThing(): Int = 1',
    '}',
    '',
  ].join('\n')),
];

/**
 * G12, reduit, dans son regime « couvert a moitie ».
 *
 * Pas `DatabaseService.OrderBy` : cet enum vide la est DEJA rapporte, par
 * `scanEnums` (voir le bloc sur le recouvrement dans
 * `G12.ANestedDeclarationNobodyJudgesWhole.test.ts`). La forme qui n est
 * couverte qu a moitie est la CLASSE imbriquee : `unusedMembers` voit ses
 * membres et les rapporte, personne ne juge la declaration qui les tient.
 * Sur le corpus de reference, 811 classes imbriquees sur 5343, soit 15 %.
 *
 * Ce que ce fixture montre : le circuit coupe le champ, et laisse la coquille.
 */
const G12 = [
  f('Holder.java', [
    'package com.x;',
    '',
    'public class Holder {',
    '',
    '\tpublic static class Inner {',
    '\t\tpublic int col;',
    '\t}',
    '',
    '\tpublic void query() {}',
    '}',
    '',
  ].join('\n')),
  f('Main.kt', 'package com.x\n\nfun main() {\n    Holder().query()\n}\n'),
];

// ── Temoins de bonne formation ──────────────────────────────────────────────

describe('le circuit fait bien son travail sur ce corpus', () => {
  it('coupe une classe morte de facon evidente', () => {
    const r = circuit([CANARI, VIVANT]);
    expect(r.coupes).toContain('symboles:CanaryGone');
    expect(r.fichiers).not.toContain('CanaryGone.kt');
  });

  it('enchaine les rondes : une coupe orpheline la suivante', () => {
    const r = circuit([
      f('A.kt', 'package com.x\n\nclass A {\n    fun go() = 1\n}\n'),
      f('B.kt', 'package com.x\n\nclass B {\n    fun run() = A().go()\n}\n'),
      VIVANT,
    ]);
    expect(r.rondes).toBe(2);
    expect(r.coupes).toContain('symboles:B');
    expect(aCoupe(r, 'A')).toBe(true);
  });
});

// ── Ce que le circuit rattrape, et que la mesure par detecteur ratait ───────

describe('la limite des ilots n est pas la falaise que G13 decrit', () => {
  it('une chaine de neuf se defait par un bout, ronde apres ronde', () => {
    const r = circuit([...chaine(9), VIVANT]);
    expect(r.fichiers).toEqual(['Main.kt']);
  });

  /**
   * Vingt ne passe pas : une chaine se defait d une classe par ronde, et le
   * plafond est a seize. Cinq fichiers restent. Ce n est PAS un trou, et
   * c est la difference qui compte : la commande le DIT, en finissant sur
   * « Stopped after the last allowed round: run it again to see whether
 * anything is left » (RemoveEverythingUnused). Une deuxieme
   * execution finit le travail.
   *
   * Le plafond a ete mesure, pas devine : huit arretait la commande deux
   * passes trop tot sur le projet de reference, seize laisse de la marge
 * (RemoveEverythingUnused).
   */
  it('une chaine de vingt depasse le plafond, et la commande le dit', () => {
    const r = circuit([...chaine(20), VIVANT]);
    expect(r.rondes).toBe(16);
    expect(r.fichiers).toHaveLength(6);
  });

  it('un cycle de douze se defait par le milieu, par ses membres non lus', () => {
    const r = circuit([...cycleMuet(12), VIVANT]);
    expect(r.coupes.filter(c => c === 'membres:go')).toHaveLength(12);
    expect(r.fichiers).toEqual(['Main.kt']);
  });

  it('un cycle de quatre dont chaque methode est lue part entier', () => {
    const r = circuit([...cycleLu(4), VIVANT]);
    expect(r.fichiers).toEqual(['Main.kt']);
  });
});

// ── Le vrai residu ──────────────────────────────────────────────────────────

describe('la forme que le circuit ne sait pas defaire', () => {
  /**
   * Cinq classes, une methode chacune, toutes lues : dix declarations, deux de
   * plus que la limite. Rien du dehors ne les nomme. Le circuit ne bouge pas.
   */
  it.fails('un cycle de cinq dont chaque methode est lue devrait partir', () => {
    const r = circuit([...cycleLu(5), VIVANT]);
    expect(r.fichiers).toEqual(['Main.kt']);
  });

  it.fails('un cycle de huit dont chaque methode est lue devrait partir', () => {
    const r = circuit([...cycleLu(8), VIVANT]);
    expect(r.fichiers).toEqual(['Main.kt']);
  });

  /**
   * La sentinelle de cette forme. Elle fixe l etat mesure : pas une coupe,
   * pas une ronde. Elle tombera le jour ou la limite saura se signaler.
   */
  it('aujourd hui, ce cycle ne declenche aucune ronde', () => {
    const r = circuit([...cycleLu(5), VIVANT]);
    expect(r.rondes).toBe(0);
    expect(r.fichiers).toHaveLength(6);
  });

  /**
   * La falaise tombe a CINQ, pas a neuf : la limite compte les declarations,
   * et une classe qui porte une methode en vaut deux. Ce test fixe les deux
   * bords de la marche, pour qu un changement de limite se voie ici.
   */
  it('la marche se situe entre quatre et cinq classes, pas entre huit et neuf', () => {
    expect(circuit([...cycleLu(4), VIVANT]).rondes).toBeGreaterThan(0);
    expect(circuit([...cycleLu(5), VIVANT]).rondes).toBe(0);
  });
});

describe('les trous qui survivent au circuit entier', () => {
  it.fails('G4 : l interface qui ne sert qu a une liaison morte devrait partir', () => {
    const r = circuit([...G4, CANARI]);
    expect(aCoupe(r, 'ShellMainLayout')).toBe(true);
  });

  it.fails('G4 : sa methode de fourniture devrait partir avec elle', () => {
    const r = circuit([...G4, CANARI]);
    expect(aCoupe(r, 'provideShellMainLayout')).toBe(true);
  });

  it.fails('G2 : un @Module que personne n installe devrait partir', () => {
    const r = circuit([...G2, CANARI, VIVANT]);
    expect(aCoupe(r, 'MainActivityV2Module')).toBe(true);
  });

  it.fails('G12 : une classe imbriquee morte devrait partir entiere', () => {
    const r = circuit([...G12, CANARI]);
    expect(aCoupe(r, 'Inner')).toBe(true);
  });

  /**
   * Le plus instructif des trois. Le circuit VOIT que le champ n est pas lu,
   * le coupe, et laisse une classe vide derriere lui. Il juge l interieur de
   * la declaration imbriquee sans jamais juger la declaration.
   */
  it('aujourd hui, G12 vide la coquille et la laisse', () => {
    const r = circuit([...G12, CANARI]);
    expect(r.coupes).toContain('membres:col');
    expect(r.texte('Holder.java')).toContain('class Inner');
  });

  it('aujourd hui, le motif de G4 ne coute au circuit que le canari', () => {
    const r = circuit([...G4, CANARI]);
    expect(r.coupes.filter(c => !c.includes('Canary'))).toEqual([]);
  });

  it('aujourd hui, le motif de G2 ne coute au circuit que le canari', () => {
    const r = circuit([...G2, CANARI, VIVANT]);
    expect(r.coupes.filter(c => !c.includes('Canary'))).toEqual([]);
  });
});

// ── Gardes : ce que le circuit ne doit PAS toucher ──────────────────────────

describe('le circuit epargne ce qui vit', () => {
  it('une classe vivante, pendant qu il coupe le canari', () => {
    const r = circuit([
      f('Vivante.kt', 'package com.x\n\nclass Vivante {\n    fun go() = 1\n}\n'),
      CANARI,
      f('Main.kt', 'package com.x\n\nfun main() {\n    println(Vivante().go())\n}\n'),
    ]);
    epargne(r, 'Vivante');
  });

  it('une classe que seul un test nomme', () => {
    const r = circuit([
      { path: '/w/app/src/main/java/com/x/Util.kt', text: 'package com.x\n\nclass Util {\n    fun go() = 1\n}\n' },
      { path: '/w/app/src/test/java/com/x/UtilTest.kt', text: 'package com.x\n\nclass UtilTest {\n    fun t() = Util().go()\n}\n' },
      CANARI, VIVANT,
    ]);
    epargne(r, 'Util');
  });

  it('une fourniture Dagger que quelqu un demande vraiment', () => {
    const r = circuit([
      f('Thing.kt', 'package com.x\n\nclass Thing\n'),
      f('ThingModule.kt', [
        'package com.x',
        '',
        'import dagger.Module',
        'import dagger.Provides',
        '',
        '@Module',
        'class ThingModule {',
        '',
        '    @Provides',
        '    fun provideThing(): Thing = Thing()',
        '}',
        '',
      ].join('\n')),
      f('Consommateur.kt', [
        'package com.x',
        '',
        'import javax.inject.Inject',
        '',
        'class Consommateur @Inject constructor(private val t: Thing) {',
        '    fun go() = t',
        '}',
        '',
      ].join('\n')),
      CANARI,
      f('Main.kt', 'package com.x\n\nfun main() {\n    println(Consommateur(Thing()).go())\n}\n'),
    ]);
    epargne(r, 'provideThing');
    expect(aCoupe(r, 'ThingModule')).toBe(false);
  });

  /**
   * L implementation concrete reste, meme quand l interface est en cause :
   * ses methodes sont appelees sur le type concret. Le jour ou G4 sera
   * implemente, c est la garde qui dira que la coupe s est arretee au bon
   * endroit.
   */
  it('l implementation concrete, pendant que l interface est en cause', () => {
    const r = circuit([...G4, CANARI]);
    expect(r.coupes).toContain('symboles:CanaryGone');
    expect(aCoupe(r, 'AppMainLayout')).toBe(false);
    expect(aCoupe(r, 'show')).toBe(false);
  });

  /**
   * Le corpus tronque, lui, n est pas garde ICI, et ce test le fixe pour
   * qu on ne s y trompe pas. `collecterUnePasse` ne transmet pas `truncated`
   * aux familles : son `base` ne porte que `sources` et `testSourceSets`.
   * Un fichier seul y passe donc pour mort.
   *
   * Ce n est pas un faux positif, parce que la boucle ne tourne jamais sur un
   * corpus tronque : la commande sort AVANT de l appeler, sur
   * `if (data.sourcesTruncated) { incomplet = true; break; }`
 * (RemoveEverythingUnused), et repond « Nothing was removed: the
   * workspace could not be read whole ».
   *
   * La garde vit donc un etage plus haut. Si quelqu un appelle un jour
   * `collecterUnePasse` depuis un autre endroit, ce test lui rappelle qu il
   * doit verifier la troncature lui meme.
   */
  it('ne garde pas lui meme contre un corpus tronque : la garde est au dessus', () => {
    const r = circuit([
      f('Api.kt', 'package com.x\n\nclass Api {\n    fun call() = 1\n}\n'),
    ]);
    expect(aCoupe(r, 'Api')).toBe(true);
  });
});
