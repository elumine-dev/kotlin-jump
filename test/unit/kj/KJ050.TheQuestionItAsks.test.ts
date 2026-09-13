import { describe, it, expect } from 'vitest';
import { libelleDeLaDemande } from '../../../src/commands/RemoveEverythingUnused';
import { sweepFile, planFileEdits } from '../../../src/providers/DeadCodeSweep';

/**
 * Ce que la commande demande avant d agir.
 *
 * Le compte affiche retire les renommages, parce qu un parametre de lambda
 * rebaptise `_` n est pas une suppression. Mais une passe peut ne contenir QUE
 * des renommages, et il en faut tres peu : un seul `forEachIndexed { index,
 * valeur ->` dont l index ne sert pas. Le titre annoncait alors
 * « Remove 0 unused declarations, locals and imports? », une demande
 * d autorisation pour ne rien retirer.
 */
describe('KJ-050 la question posee', () => {
  it('un melange annonce les suppressions et note les renommages', () => {
    const d = libelleDeLaDemande(10, 3, 4);
    expect(d.titre).toBe('Remove 7 unused declarations, locals and imports?');
    expect(d.detail).toContain('3 unused names renamed to `_` rather than removed.');
    expect(d.detail).toContain('Apply all repeats');
  });

  it('un seul element garde le singulier', () => {
    expect(libelleDeLaDemande(1, 0, 1).titre).toBe('Remove 1 unused declaration, local or import?');
  });

  it('sans renommage, aucune note a leur sujet', () => {
    expect(libelleDeLaDemande(4, 0, 2).detail).not.toContain('renamed');
  });

  it('une passe faite QUE de renommages pose la vraie question', () => {
    const d = libelleDeLaDemande(3, 3, 1);
    expect(d.titre).toBe('Rename 3 unused names to `_`?');
    expect(d.titre).not.toContain('Remove 0');
  });

  it('et n invoque pas la relance, car un renommage n orpheline rien', () => {
    expect(libelleDeLaDemande(3, 3, 1).detail).not.toContain('orphans the next');
  });

  it('un seul renommage garde le singulier', () => {
    expect(libelleDeLaDemande(1, 1, 1).titre).toBe('Rename 1 unused name to `_`?');
  });
});

/**
 * Le cas de tete vient du vrai detecteur, pas d une idee de ce qu il produit :
 * un index de `forEachIndexed` jamais lu est un renommage et rien d autre.
 */
describe('KJ-050 le cas qui ne retire rien vient du detecteur', () => {
  const SOURCE = `class A {
    fun f(liste: List<Int>) {
        liste.forEachIndexed { index, valeur -> println(valeur) }
    }
}
`;

  it('une passe de renommages seuls est bien atteignable', () => {
    const plan = planFileEdits(sweepFile(SOURCE, 'kotlin'));
    expect(plan.length).toBeGreaterThan(0);
    const renommages = plan.filter(e => e.text !== '').length;
    expect(renommages).toBe(plan.length);
    expect(libelleDeLaDemande(plan.length, renommages, 1).titre)
      .toBe(`Rename ${renommages === 1 ? '1 unused name' : `${renommages} unused names`} to \`_\`?`);
  });
});
