import { describe, it, expect } from 'vitest';
import { collectValueResourceRefs, importedResourcePrefixes } from '../../../src/util/xmlRefs';

/**
 * Deux facons de perdre une reference a une ressource, donc de supprimer une
 * cle vivante.
 *
 * 1. Le nom d'un champ R ne porte JAMAIS de point : aapt reecrit `.` en `_`.
 *    Dans du code, un point apres la cle est forcement un acces membre. La
 *    classe du nom l'admettait pourtant, et `R.color.x.toDrawable()` etait
 *    enregistre sous `x.toDrawable` : la reference a `x` n'existait plus.
 *    Sur un vrai projet, `R.color.imagePlaceholderColor.toDrawable()`.
 *    La branche XML, elle, a besoin des points : `@style/Base.Kj` en porte un.
 *
 * 2. L'exclusion du `R` de la plateforme testait `(^|\.)android\.`, donc tout
 *    paquet dont le dernier segment est `android`, une convention tres
 *    repandue. Dans un tel module, `import <ns>.R.color` n'enregistrait aucun
 *    prefixe et toutes ses cles devenaient invisibles.
 */

describe('references de ressources depuis du code', () => {
  it('un acces membre apres la cle ne fait pas partie du nom', () => {
    const kt = 'package p\n\nval d = R.color.ma_couleur.toDrawable()\n';
    expect(collectValueResourceRefs(kt, 'a/B.kt', ['color'])).toEqual([{ kind: 'color', name: 'ma_couleur' }]);
  });

  it('une chaine d appels non plus', () => {
    const kt = 'package p\n\nval s = R.string.titre.trim().uppercase()\n';
    expect(collectValueResourceRefs(kt, 'a/B.kt', ['string'])).toEqual([{ kind: 'string', name: 'titre' }]);
  });

  it('meme a travers un import de R', () => {
    const kt = 'package p\n\nimport ca.foo.R.color\n\nval d = color.ma_couleur.toDrawable()\n';
    expect(collectValueResourceRefs(kt, 'a/B.kt', ['color'])).toEqual([{ kind: 'color', name: 'ma_couleur' }]);
  });

  it('temoin XML : un nom de style garde ses points', () => {
    const xml = '<style name="X" parent="@style/Base.Kj"/>';
    expect(collectValueResourceRefs(xml, 'res/values/styles.xml', ['style']))
      .toEqual([{ kind: 'style', name: 'Base.Kj' }]);
  });

  it('temoin : une reference simple est inchangee', () => {
    expect(collectValueResourceRefs('val c = R.color.simple\n', 'a/B.kt', ['color']))
      .toEqual([{ kind: 'color', name: 'simple' }]);
  });
});

describe('exclusion du R de la plateforme', () => {
  it('android.R reste exclu', () => {
    expect(importedResourcePrefixes('import android.R.string\n')).toEqual([]);
    expect(importedResourcePrefixes('import static android.R.string;\n')).toEqual([]);
  });

  for (const imp of [
    'import com.mycompany.android.R.string',
    'import ca.lapresse.android.R.string',
  ]) {
    it(`un paquet finissant par .android n est PAS la plateforme : ${imp}`, () => {
      expect(importedResourcePrefixes(imp + '\n')).toEqual([{ prefix: 'string', kind: 'string' }]);
    });
  }

  it('la forme avec alias non plus', () => {
    expect(importedResourcePrefixes('import com.mycompany.android.R as AppR\n')).toEqual([{ prefix: 'AppR' }]);
  });

  it('temoin : androidx passait deja', () => {
    expect(importedResourcePrefixes('import com.mycompany.androidx.R.string\n'))
      .toEqual([{ prefix: 'string', kind: 'string' }]);
  });
});
