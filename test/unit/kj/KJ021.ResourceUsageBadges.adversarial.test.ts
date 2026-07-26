import { describe, it, expect } from 'vitest';
import {
  countResourceUsages,
  countAllResourceUsages,
} from '../../../src/providers/ResourceUsageBadgeProvider';

/** KJ-021 — tentatives de casse au-delà du contrat. */

describe('KJ-021 adversarial', () => {
  it('usage en COMMENTAIRE Kotlin : ne compte pas', () => {
    expect(
      countResourceUsages('string', 'x', [
        { path: 'a.kt', text: '// R.string.x est documenté ici\nval y = 1' },
      ])
    ).toBe(0);
  });

  it('usage en commentaire XML : ne compte pas', () => {
    expect(
      countResourceUsages('color', 'x', [
        { path: 'l.xml', text: '<!-- android:background="@color/x" -->\n<View/>' },
      ])
    ).toBe(0);
  });

  it('R.string.x dans une string Kotlin : compte (choix assumé — templates)', () => {
    // Les refs dans les strings Kotlin sont quasi toujours des templates
    // ${R.string.x} : on ne blanchit pas les strings côté usage.
    expect(
      countResourceUsages('string', 'x', [
        { path: 'a.kt', text: 'val s = context.getString(R.string.x)' },
      ])
    ).toBe(1);
  });

  it('même nom, kinds différents : pas de contamination', () => {
    const sources = [{ path: 'a.kt', text: 'val c = R.color.primary' }];
    expect(countResourceUsages('string', 'primary', sources)).toBe(0);
    expect(countResourceUsages('color', 'primary', sources)).toBe(1);
  });

  it('attribut app: (non-tools) avec ref : compte', () => {
    expect(
      countResourceUsages('string', 'cap', [
        { path: 'l.xml', text: '<Chip app:chipText="@string/cap"/>' },
      ])
    ).toBe(1);
  });

  it('BUG-HUNT-16 : passe unique — 200 entrées × 300 fichiers sous 400 ms (perf = feature n° 1 du projet)', () => {
    const names = Array.from({ length: 200 }, (_, i) => ({
      kind: 'string' as const,
      name: `res_${i}`,
    }));
    const sources = Array.from({ length: 300 }, (_, f) => ({
      path: `F${f}.kt`,
      text: Array.from({ length: 30 }, (_, l) => `val v${l} = R.string.res_${(f + l) % 200}`).join('\n'),
    }));
    const start = performance.now();
    const counts = countAllResourceUsages(names, sources);
    const elapsed = performance.now() - start;
    expect(counts.get('string/res_0')! > 0).toBe(true);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(300 * 30);
    expect(elapsed).toBeLessThan(400);
  });

  it('BUG-HUNT-16b : la passe unique donne les mêmes comptes que la version unitaire', () => {
    const sources = [
      { path: 'a.kt', text: 'val x = R.string.alpha\nval y = R.color.alpha' },
      { path: 'l.xml', text: '<TextView android:text="@string/alpha" tools:text="@string/beta"/>' },
    ];
    const counts = countAllResourceUsages(
      [
        { kind: 'string', name: 'alpha' },
        { kind: 'string', name: 'beta' },
        { kind: 'color', name: 'alpha' },
      ],
      sources,
    );
    expect(counts.get('string/alpha')).toBe(countResourceUsages('string', 'alpha', sources));
    expect(counts.get('string/beta')).toBe(0);
    expect(counts.get('color/alpha')).toBe(1);
  });

  it('BUG-HUNT-2 : ref en TEXTE d’élément XML comptée (<item>@string/x</item>)', () => {
    // Les string-arrays et les alias de couleurs référencent en contenu
    // d'élément, pas en attribut — c'était un angle mort du compteur.
    expect(
      countResourceUsages('string', 'easy', [
        { path: 'arrays.xml', text: '<string-array name="lvls"><item>@string/easy</item></string-array>' },
      ])
    ).toBe(1);
    expect(
      countResourceUsages('color', 'primary', [
        { path: 'colors_refs.xml', text: '<color name="brand">@color/primary</color>' },
      ])
    ).toBe(1);
  });

  it('valeur qui CONTIENT la ref sans être exactement la ref : ignorée', () => {
    expect(
      countResourceUsages('string', 'cap', [
        { path: 'l.xml', text: '<TextView android:text="prefix @string/cap"/>' },
      ])
    ).toBe(0);
  });
});
