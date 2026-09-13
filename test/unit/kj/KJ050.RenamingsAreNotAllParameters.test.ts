import { describe, it, expect } from 'vitest';
import { libelleDeLaDemande, resumeDesFamilles, compteRendu } from '../../../src/commands/RemoveEverythingUnused';
import { sweepFile, planFileEdits } from '../../../src/providers/DeadCodeSweep';

/**
 * Ce que la commande rebaptise `_` n est pas forcement un parametre.
 *
 * Deux choses recoivent ce traitement : un parametre de lambda jamais lu, et
 * une exception attrapee jamais lue. Le compteur les a fondues sous
 * « unused parameter » quand il a ete separe des suppressions.
 *
 * Ce n est pas un cas de bord, c est le cas ordinaire : sur le projet de
 * reference, 5110 fichiers, 38 des 41 renommages sont des exceptions
 * attrapees et 3 seulement des parametres de lambda. La phrase etait donc
 * fausse 38 fois sur 41.
 */

const AVEC_CATCH = `class A {
    fun f() {
        try {
            risque()
        } catch (e: IllegalStateException) {
            recupere()
        }
    }
}
`;

describe('KJ-050 les renommages ne sont pas tous des parametres', () => {
  it('temoin : une exception attrapee inutilisee est bien un renommage', () => {
    const findings = sweepFile(AVEC_CATCH, 'kotlin');
    const renommants = findings.filter(f => f.edits.some(e => e.text !== ''));
    expect(renommants.length).toBeGreaterThan(0);
    expect(renommants[0].message).toContain('Caught exception');
    expect(renommants[0].edits.find(e => e.text !== '')!.text).toBe('_');
  });

  it('temoin : elle survit au plan, donc elle atteint le compteur', () => {
    const plan = planFileEdits(sweepFile(AVEC_CATCH, 'kotlin'));
    expect(plan.filter(e => e.text !== '').length).toBeGreaterThan(0);
  });

  it('le titre ne les appelle pas des parametres', () => {
    expect(libelleDeLaDemande(1, 1, 1).titre).not.toContain('parameter');
    expect(libelleDeLaDemande(38, 38, 5).titre).not.toContain('parameter');
  });

  it('la note du dialogue non plus', () => {
    expect(libelleDeLaDemande(100, 38, 5).detail).not.toContain('parameter');
  });

  it('mais elle dit toujours combien et ce qui leur arrive', () => {
    const d = libelleDeLaDemande(100, 38, 5);
    expect(d.detail).toContain('38 unused names renamed to `_` rather than removed.');
    expect(libelleDeLaDemande(38, 38, 5).titre).toBe('Rename 38 unused names to `_`?');
    expect(libelleDeLaDemande(1, 1, 1).titre).toBe('Rename 1 unused name to `_`?');
  });
});

/**
 * Le compte rendu final, qui etait compose en ligne et donc hors de portee de
 * tout test : y remettre `unused parameter` ne cassait rien, alors que le meme
 * mot dans le dialogue cassait cinq assertions.
 */
describe('KJ-050 le compte rendu final', () => {
  const vide = {
    symboles: 0, membres: 0, entrees: 0, ilots: 0,
    balayage: 0, renommages: 0, imports: 0, fichiers: 0, bouges: 0,
  };

  it('ne les appelle pas des parametres non plus', () => {
    expect(resumeDesFamilles({ ...vide, renommages: 38 })).toBe('38 unused names renamed to `_`');
    expect(resumeDesFamilles({ ...vide, renommages: 1 })).toBe('1 unused name renamed to `_`');
  });

  it('accorde les enumerations qu il compose', () => {
    expect(resumeDesFamilles({ ...vide, balayage: 5 })).toBe('5 locals and imports');
    expect(resumeDesFamilles({ ...vide, balayage: 1 })).toBe('1 local or import');
  });

  it('garde les pluriels irreguliers', () => {
    expect(resumeDesFamilles({ ...vide, entrees: 3 })).toBe('3 enum entries');
    expect(resumeDesFamilles({ ...vide, entrees: 1 })).toBe('1 enum entry');
  });

  it('enchaine les familles dans l ordre, et tait celles a zero', () => {
    expect(resumeDesFamilles({ ...vide, symboles: 2, renommages: 1, fichiers: 3 }))
      .toBe('2 declarations, 1 unused name renamed to `_`, 3 emptied files');
  });

  it('rien du tout rend une chaine vide, que compteRendu sait lire', () => {
    expect(resumeDesFamilles(vide)).toBe('');
    expect(compteRendu('', { verbe: 'Removed', queue: '.', annule: false, restait: false, bouges: '' }))
      .toBe('Nothing unused left to remove.');
  });
});
