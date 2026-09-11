/**
 * Quand l'extraction pose l'IDENTIFIANT nu plutot qu'un appel a getString.
 *
 * `setText(R.string.x)` compile parce que `TextView.setText` a une surcharge
 * qui prend un `int`. Trois entrees de la liste n'en ont pas, verifie dans le
 * SDK Android 36 et dans Material 1.13 :
 *
 *   TextView.setError(CharSequence) et setError(CharSequence, Drawable)
 *   View.setContentDescription(CharSequence)
 *   TextInputLayout.setHelperText(CharSequence), setError(CharSequence)
 *
 * Leur passer `R.string.x` revient a passer un `Int` la ou une `CharSequence`
 * est attendue : le projet ne compile plus. Aucun littéral du projet de
 * reference n'est dans ce cas aujourd'hui, mais `setError("Champ requis")` est
 * un idiome des plus courants.
 */
import { describe, it, expect } from 'vitest';
import { isResIdSetterArgument, buildReplacement } from '../../src/providers/ExtractStringResourceProvider';

/** Le texte qui remplacerait le littéral de cette ligne. */
function remplacement(ligne: string): string {
  const col = ligne.indexOf('"');
  return buildReplacement('x', 'cle', 'code', [], isResIdSetterArgument(ligne, col));
}

describe('un setter sans surcharge int recoit une chaine, pas un identifiant', () => {
  for (const setter of ['setError', 'setContentDescription', 'setHelperText']) {
    it(`${setter} recoit getString`, () => {
      expect(remplacement(`    champ.${setter}("Champ requis")`)).toBe('getString(R.string.cle)');
    });
  }
});

describe('les setters qui ont bien une surcharge int gardent l identifiant nu', () => {
  for (const setter of ['setText', 'setHint', 'setTitle', 'setSubtitle', 'setMessage']) {
    it(`${setter} recoit R.string`, () => {
      expect(remplacement(`    vue.${setter}("Bonjour")`)).toBe('R.string.cle');
    });
  }

  it('et les boutons d un dialogue aussi', () => {
    expect(remplacement('    builder.setPositiveButton("Oui", listener)')).toBe('R.string.cle');
  });
});

describe('ce qui n est pas un argument direct reste une chaine', () => {
  it('un litteral en deuxieme position', () => {
    const ligne = '    vue.setText("a", "b")';
    const col = ligne.lastIndexOf('"b"');
    expect(buildReplacement('b', 'cle', 'code', [], isResIdSetterArgument(ligne, col)))
      .toBe('getString(R.string.cle)');
  });

  it('une affectation ordinaire', () => {
    expect(remplacement('    val message = "Bonjour"')).toBe('getString(R.string.cle)');
  });
});
