import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Une commande pour toute la famille.
 *
 * Cinq commandes retiraient cinq sortes de code mort, et les enchainer dans le
 * bon ordre etait le travail de l'utilisateur. Pire, une passe ne suffit
 * jamais : une suppression en orpheline une autre, et sur un vrai projet les
 * retraits ne se sont stabilises qu'a la QUATRIEME ronde.
 *
 * Ce qui rend une passe sure, c'est que toutes ses coupes sont mesurees sur le
 * MEME texte. Les chevauchements a l'interieur d'un fichier se resolvent comme
 * chez chaque fournisseur : la premiere gagne.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin'];

describe('collecterUnePasse', () => {
  it('ramasse PLUSIEURS familles dans une seule passe', () => {
    const sources = [
      { path: `${MAIN}/Mort.kt`, text: 'package com.x\n\nclass Mort\n' },
      { path: `${MAIN}/Enum.kt`, text: 'package com.x\n\nenum class E {\n    VIVANT,\n    MORTE\n}\n' },
      { path: `${MAIN}/Use.kt`, text: 'package com.x\n\nval u = E.VIVANT\n' },
    ];
    const { parFichier, tally } = collecterUnePasse(sources, SEGS);
    // Deux familles au moins, ce qui est tout l'interet de la commande : une
    // seule passe voit ce que cinq commandes voyaient separement.
    const familles = Object.entries(tally).filter(([, n]) => n > 0).map(([k]) => k);
    expect(familles.length).toBeGreaterThanOrEqual(2);
    expect(familles).toContain('symboles');
    expect(parFichier.size).toBeGreaterThan(0);
  });

  it('aucune paire de coupes d un meme fichier ne se recouvre', () => {
    const sources = [
      { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass MortA\n\nclass MortB\n\nclass MortC\n' },
      { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun r() = 1\n' },
    ];
    for (const [, l] of collecterUnePasse(sources, SEGS).parFichier) {
      const triees = [...l].sort((a, b) => a.start - b.start);
      for (let i = 1; i < triees.length; i++) {
        expect(triees[i].start, 'les coupes ne se recouvrent pas').toBeGreaterThanOrEqual(triees[i - 1].end);
      }
    }
  });

  it('rien a faire quand tout est atteignable depuis une racine', () => {
    // Une fixture ou `val b` ne serait reference par personne serait elle meme
    // du code mort : un temoin qui ne prouve rien. `fun main` est une racine.
    const sources = [
      { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass A {\n    fun go() = 1\n}\n' },
      { path: `${MAIN}/Main.kt`, text: 'package com.x\n\nfun main() {\n    println(A().go())\n}\n' },
    ];
    const { parFichier } = collecterUnePasse(sources, SEGS);
    expect([...parFichier.values()].reduce((n, l) => n + l.length, 0)).toBe(0);
  });

  it('les coupes rendues tiennent dans le texte et le laissent equilibre', () => {
    const sources = [
      { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass MortA {\n    fun x() = 1\n}\n\nclass Vivante\n' },
      { path: `${MAIN}/B.kt`, text: 'package com.x\n\nval b = Vivante()\n' },
    ];
    const { parFichier } = collecterUnePasse(sources, SEGS);
    for (const [p, l] of parFichier) {
      const texte = sources.find(s => s.path === p)!.text;
      let out = texte;
      for (const c of [...l].sort((a, b) => b.start - a.start)) {
        expect(c.start).toBeGreaterThanOrEqual(0);
        expect(c.end).toBeLessThanOrEqual(texte.length);
        out = out.slice(0, c.start) + c.texte + out.slice(c.end);
      }
      const solde = (t: string) => [...t].reduce((n, ch) => n + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
      expect(solde(out), `${p} reste equilibre`).toBe(solde(texte));
    }
  });
});

/**
 * Un renommage n'est pas une suppression, et ne doit pas se compter comme
 * telle.
 *
 * Le balayage ne fait pas que supprimer : il remplace aussi un parametre de
 * lambda inutilise par `_`, ce qui ne retire rien et n'est pas une
 * declaration. Comptes ensemble, ils faisaient annoncer « Remove 320 unused
 * declarations » pour 279 suppressions et 41 renommages, sur un vrai projet.
 */
describe('collecterUnePasse : suppressions et renommages', () => {
  it('un parametre de lambda inutilise compte comme renommage', () => {
    const sources = [
      { path: `${MAIN}/A.kt`, text: 'package com.x\n\nfun go(f: (Int) -> Unit) = f(1)\n\nfun main() {\n    go { inutilise -> println(2) }\n}\n' },
    ];
    const { parFichier, tally } = collecterUnePasse(sources, SEGS);
    const toutes = [...parFichier.values()].flat();
    const remplacements = toutes.filter(c => c.texte !== '');
    // Ce que la sonde a mesure sur le vrai projet : le balayage rend bien des
    // remplacements, et ils sortent du compte des suppressions.
    expect(tally.renommages).toBe(remplacements.length);
    expect(tally.balayage).toBe(toutes.filter(c => c.famille === 'balayage' && c.texte === '').length);
  });

  it('aucune coupe a texte vide ne compte comme renommage', () => {
    const sources = [
      { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass MortA\n\nclass MortB\n' },
      { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun r() = 1\n' },
    ];
    const { parFichier, tally } = collecterUnePasse(sources, SEGS);
    const toutes = [...parFichier.values()].flat();
    expect(toutes.every(c => c.texte === '')).toBe(true);
    expect(tally.renommages).toBe(0);
  });
});

/**
 * Une trouvaille de Remote Config porte un NOM et la liste de ses
 * declarations, une par variante de build. La coupe est sur chaque
 * declaration, jamais sur la trouvaille.
 *
 * La collecte lisait `k.path`, `k.removeStart` et `k.removeEnd` a plat, donc
 * trois fois `undefined`. `ajoute` ne rejetait pas ces bornes, il rangeait la
 * coupe sous la clef `undefined`. Invisible sur le projet de reference, ou le
 * coupe circuit de la famille rendait zero trouvaille : il a fallu desarmer ce
 * coupe circuit pour que le defaut se voie.
 */
describe('collecterUnePasse : les cles de Remote Config', () => {
  const DEFAUTS = (variante: string) => ({
    path: `/w/app/src/${variante}/res/xml/remote_config_defaults.xml`,
    text: [
      '<defaults>',
      '    <entry>',
      '        <key>enable_dark_mode</key>',
      '        <value>false</value>',
      '    </entry>',
      '</defaults>',
      '',
    ].join('\n'),
  });

  it('coupe chaque declaration, et dans son propre fichier', () => {
    const sources = [DEFAUTS('main'), DEFAUTS('debug'), DEFAUTS('release')];
    const { parFichier } = collecterUnePasse(sources, SEGS);

    const coupes = [...parFichier.entries()].flatMap(
      ([p, l]) => l.filter(c => c.famille === 'remoteconfig').map(c => ({ p, ...c })),
    );
    expect(coupes).toHaveLength(3);
    expect(new Set(coupes.map(c => c.p))).toEqual(new Set(sources.map(s => s.path)));
    for (const c of coupes) {
      expect(c.quoi).toBe('enable_dark_mode');
      expect(Number.isInteger(c.start)).toBe(true);
      expect(c.end).toBeGreaterThan(c.start);
    }
  });

  /**
   * Le defaut ne laissait aucune trace lisible : pas de coupe, mais une clef
   * `undefined` dans la carte. Une clef qui n'est pas un chemin de source est
   * un aveu, quelle que soit la famille.
   */
  it('et aucune coupe ne se range sous un chemin inconnu', () => {
    const sources = [DEFAUTS('main'), DEFAUTS('debug')];
    const chemins = new Set(sources.map(s => s.path));
    for (const p of collecterUnePasse(sources, SEGS).parFichier.keys()) {
      expect(chemins.has(p), `coupe rangee sous ${String(p)}`).toBe(true);
    }
  });
});
