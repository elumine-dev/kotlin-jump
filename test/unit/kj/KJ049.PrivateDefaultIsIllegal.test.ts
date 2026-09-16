import { describe, it, expect } from 'vitest';
import { narrowToPrivate } from '../../../src/providers/narrowToPrivate';

/**
 * `private default` n'existe dans aucune version de Java.
 *
 * Une methode `default` EST une methode d'interface publique a corps ; les deux
 * mots s'excluent, et javac repond `illegal combination of modifiers: private
 * and default`. La garde qui refuse de resserrer ne connaissait que `open`,
 * `abstract` et `sealed`, tous trois cotes Kotlin, alors que `default` figurait
 * bien dans la liste des modificateurs a consommer. La commande
 * « Make Every Self Only Member Private » produisait donc une ligne qui ne
 * compile pas, dans un fichier que l'utilisateur n'a pas ouvert.
 *
 * Reproduit au minimum : une interface Java dont la methode a corps n'est
 * appelee que par sa voisine. Pas atteignable sur
 * /workspace/exampleapp aujourd'hui, ou aucune methode `default`
 * n'est selfOnly, mais l'edition casse le build partout ailleurs.
 */

describe('narrowToPrivate et le mot default', () => {
  it('une methode default Java n est pas resserree', () => {
    expect(narrowToPrivate('    default String prefixe() { return "> "; }')).toBeUndefined();
  });

  it('meme portant deja une visibilite', () => {
    expect(narrowToPrivate('    public default int x() { return 1; }')).toBeUndefined();
  });

  it('meme precedee d une annotation', () => {
    expect(narrowToPrivate('    @Override default String y() { return ""; }')).toBeUndefined();
  });

  it('temoin : une methode Java sans default est resserree', () => {
    const n = narrowToPrivate('    String prefixe() { return "> "; }');
    expect(n).toBeDefined();
    expect(n!.text).toBe('private ');
  });

  it('temoin : un parametre nomme default ne bloque rien', () => {
    // La garde ne lit que la suite de modificateurs, pas la ligne entiere :
    // `default` en nom de parametre est un identifiant ordinaire.
    const ligne = '    fun choisir(default: Int): Int = default';
    const n = narrowToPrivate(ligne);
    expect(n).toBeDefined();
    expect(ligne.slice(0, n!.column) + n!.text + ligne.slice(n!.column + n!.length))
      .toBe('    private fun choisir(default: Int): Int = default');
  });

  it('temoin : open reste refuse', () => {
    expect(narrowToPrivate('    open fun x() = 1')).toBeUndefined();
  });
});
