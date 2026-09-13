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
