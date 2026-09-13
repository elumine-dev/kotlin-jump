import { describe, it, expect } from 'vitest';
import { narrowToPrivate } from '../../../src/providers/narrowToPrivate';

/**
 * Un membre qui en redefinit un autre ne peut pas devenir prive.
 *
 * La garde refusait deja `open`, `abstract`, `sealed` et le `default` de Java,
 * avec la formule du compilateur en commentaire. `override` manquait a la
 * liste, et les deux compilateurs disent la meme chose, verifie et non
 * suppose :
 *
 *   T.kt:5:5: error: cannot weaken access privilege private for 'f' in 'A'.
 *   T.kt:5:5: error: modifier 'private' is incompatible with 'override'.
 *
 *   T.java:5: error: name() in B cannot override name() in A
 *     attempting to assign weaker access privileges; was public
 *
 * Cote Java le piege est ailleurs : `@Override` est une ANNOTATION, et la
 * fonction saute la suite d annotations avant de lire les modificateurs. Il
 * faut donc la regarder aussi, pas seulement les mots cles.
 */
describe('KJ-049 un override ne peut pas devenir prive', () => {
  for (const ligne of [
    '    override fun f() = 1',
    '    public override fun f() = 1',
    '    protected override fun f() = 1',
    '    override val x: Int = 1',
    '    suspend override fun f() = 1',
    '    override suspend fun f() = 1',
  ]) {
    it(`refuse ${JSON.stringify(ligne.trim())}`, () => {
      expect(narrowToPrivate(ligne)).toBeUndefined();
    });
  }

  for (const ligne of [
    '    @Override public String toString() { return "a"; }',
    '    @Override protected void onCreate(Bundle b) { }',
    '    @Override\tpublic int hashCode() { return 1; }',
  ]) {
    it(`refuse ${JSON.stringify(ligne.trim().slice(0, 32))}`, () => {
      expect(narrowToPrivate(ligne)).toBeUndefined();
    });
  }

  it('temoin : une fonction ordinaire se resserre toujours', () => {
    const e = narrowToPrivate('    fun f() = 1');
    expect(e).toEqual({ column: 4, length: 0, text: 'private ' });
  });

  it('temoin : une visibilite existante est toujours remplacee', () => {
    expect(narrowToPrivate('    internal fun f() = 1')).toEqual({ column: 4, length: 9, text: 'private ' });
  });

  it('temoin : une autre annotation ne bloque rien', () => {
    expect(narrowToPrivate('    @JvmStatic fun f() = 1')).toBeDefined();
  });

  it('temoin : un nom qui contient override ne compte pas', () => {
    // `overrideCount` n est pas le mot cle `override`.
    expect(narrowToPrivate('    val overrideCount = 1')).toBeDefined();
    expect(narrowToPrivate('    @OverrideCheck fun f() = 1')).toBeDefined();
  });

  it('temoin : open et abstract restent refuses', () => {
    expect(narrowToPrivate('    protected open fun f() = 1')).toBeUndefined();
    expect(narrowToPrivate('    abstract fun f()')).toBeUndefined();
  });
});
