import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-049 — ou se pose `private` sur une ligne de declaration.
 *
 * Un seul endroit, partage par l'ampoule par membre et par la commande de
 * masse. Les deux existaient deja comme deux copies des trois memes lignes, et
 * une copie est exactement la maniere dont un correctif cesse de correspondre
 * a son propre diagnostic.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 142 membres « pourrait etre
 * prive », soit 142 clics sur une ampoule.
 */

const mod: any = await importOrNull('src/providers/narrowToPrivate');
const pose = (ligne: string) => {
  const e = mod.narrowToPrivate(ligne);
  return e === undefined ? undefined : ligne.slice(0, e.column) + e.text + ligne.slice(e.column + e.length);
};

describe.skipIf(!mod)('narrowToPrivate', () => {
  it('remplace le modificateur present', () => {
    expect(pose('    public fun draw() {')).toBe('    private fun draw() {');
    expect(pose('    internal val x = 1')).toBe('    private val x = 1');
    expect(pose('    protected fun onDraw() {')).toBe('    private fun onDraw() {');
  });

  it('insere a l indentation quand il n y en a pas', () => {
    expect(pose('    fun draw() {')).toBe('    private fun draw() {');
    expect(pose('\t\tval x = 1')).toBe('\t\tprivate val x = 1');
  });

  it('respecte les autres modificateurs', () => {
    expect(pose('    suspend fun load() {')).toBe('    private suspend fun load() {');
    expect(pose('    public suspend fun load() {')).toBe('    private suspend fun load() {');
  });

  it('temoin : une ligne deja privee ne bouge pas', () => {
    expect(mod.narrowToPrivate('    private fun draw() {')).toBeUndefined();
    expect(mod.narrowToPrivate('    private set')).toBeUndefined();
  });

  it('temoin : une ligne vide ne recoit rien', () => {
    expect(mod.narrowToPrivate('')).toBeUndefined();
    expect(mod.narrowToPrivate('    ')).toBeUndefined();
  });

  it('temoin : une propriete de constructeur primaire reste valide', () => {
    expect(pose('    val titre: String,')).toBe('    private val titre: String,');
  });
});
