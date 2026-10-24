import { describe, it, expect } from 'vitest';
import { sommeDesFamilles } from '../../../scripts/verify-report-matches-edit';
import { compteLesFamilles, resumeDesFamilles } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G56 — le controle du compte rendu ne comptait que six familles.
 *
 * La porte affichait « !! rapport ... ecart 1, somme 1 » depuis v1.43.0, lu
 * comme une dette du compte rendu de Remove All. Sur le projet de reference :
 * phrase 342, plages 300 + coupes de fichiers effaces 42 = 342, mais
 * « retenues » 220. La phrase et l'edition disaient vrai. C'est le CONTROLE,
 * `scripts/verify-report-matches-edit.ts`, qui sommait une liste recopiee de
 * six familles et ignorait les posts, alias, cles Remote Config, entrees de
 * baseline, methodes d'injection et contrats ajoutes depuis.
 *
 * Correctif : le controle somme toutes les familles que la passe compte.
 */

const coupe = (famille: string) => ({ start: 0, end: 1, texte: '', famille, quoi: 'x' });

describe('G56, le controle somme toutes les familles', () => {
  it('une famille ajoutee apres les six de depart est comptee', () => {
    const tally = compteLesFamilles(new Map([['/a.xml', [coupe('remoteconfig'), coupe('remoteconfig')]], ['/b.kt', [coupe('symboles')]]]));
    expect(sommeDesFamilles(tally)).toBe(3);
  });

  it('la somme du controle est celle que la phrase annonce', () => {
    const tally = compteLesFamilles(new Map([['/a.kt', [coupe('symboles'), coupe('contrats'), coupe('injections'), coupe('baseline')]]]));
    const phrase = resumeDesFamilles(tally);
    const total = [...phrase.matchAll(/(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(sommeDesFamilles(tally)).toBe(total);
  });

  it('temoin : un compte vide vaut zero', () => {
    expect(sommeDesFamilles(compteLesFamilles(new Map()))).toBe(0);
  });
});
