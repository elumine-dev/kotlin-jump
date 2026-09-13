import { describe, it, expect } from 'vitest';
import { libelleDeLaDemande } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Le titre et le detail parlent de la meme chose, avec le meme nombre.
 *
 * La ligne de detail a cesse hier d annoncer un nombre d operations d edition,
 * ce qui etait juste, mais elle s est mise a compter ce qui a ete TROUVE
 * pendant que le titre compte ce qui va etre RETIRE. Les deux different des
 * qu il y a un renommage, et le lecteur voyait « Remove 7 unused declarations,
 * locals and imports? » au dessus de « 10 unused declarations, locals and
 * imports found ».
 *
 * Pire sur une passe faite QUE de renommages : le titre disait, a raison,
 * « Rename 3 unused names to `_`? », et le detail juste en dessous les
 * appelait des declarations, des locals et des imports trouves. Un parametre
 * de lambda n est aucun des trois, et rien n est retire.
 *
 * Le compte vit donc dans le titre, une seule fois, et le detail dit ce que le
 * titre ne dit pas : dans combien de fichiers.
 */
describe('KJ-050 le titre et le detail s accordent', () => {
  it('une passe de renommages seuls ne parle plus de declarations', () => {
    const d = libelleDeLaDemande(3, 3, 1);
    expect(d.titre).toBe('Rename 3 unused names to `_`?');
    expect(d.detail).not.toContain('declaration');
    expect(d.detail).not.toContain('import');
  });

  it('un melange ne donne pas deux nombres pour la meme chose', () => {
    const d = libelleDeLaDemande(10, 3, 4);
    expect(d.titre).toBe('Remove 7 unused declarations, locals and imports?');
    // Le seul compte de declarations est celui du titre.
    expect(d.detail).not.toContain('10 unused declaration');
    expect(d.detail).not.toContain('7 unused declaration');
    expect(d.detail).toContain('3 unused names renamed to `_`');
  });

  it('le detail dit toujours dans combien de fichiers', () => {
    expect(libelleDeLaDemande(4, 0, 3).detail).toContain('3 files');
    expect(libelleDeLaDemande(4, 0, 1).detail).toContain('1 file');
    expect(libelleDeLaDemande(3, 3, 2).detail).toContain('2 files');
  });

  it('et toujours ce que chaque bouton fait', () => {
    for (const d of [libelleDeLaDemande(4, 0, 3), libelleDeLaDemande(3, 3, 1)]) {
      expect(d.detail).toContain('Apply all skips the preview');
      expect(d.detail).toContain('nothing ticked');
    }
  });

  it('la relance n est promise que si quelque chose est retire', () => {
    expect(libelleDeLaDemande(4, 0, 3).detail).toContain('Apply all repeats until nothing is left');
    expect(libelleDeLaDemande(3, 3, 1).detail).not.toContain('orphans the next');
  });

  it('temoin : sans renommage, le titre porte le compte trouve', () => {
    expect(libelleDeLaDemande(4, 0, 3).titre).toBe('Remove 4 unused declarations, locals and imports?');
    expect(libelleDeLaDemande(1, 0, 1).titre).toBe('Remove 1 unused declaration, local or import?');
  });
});
