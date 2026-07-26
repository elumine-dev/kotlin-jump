import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-021 — Badges d'usage res XML. CONTRAT :
 *   export function countResourceUsages(
 *     kind: 'string' | 'color' | 'dimen',
 *     name: string,
 *     sources: { path: string; text: string }[],
 *   ): number
 *   // Comptent : R.<kind>.name (kt/java), @<kind>/name (res XML hors namespace tools)
 *   // Ne comptent pas : tools:*, commentaires, la définition elle-même
 */
const mod: any = await importOrNull('src/providers/ResourceUsageBadgeProvider');

const sources = () => [
  { path: 'layout/view_kj_banner.xml', text: fixture('src/main/res/layout/view_kj_banner.xml') },
  {
    path: 'kj/g3navigation/ScreensDemo.kt',
    text: fixture('src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt'),
  },
  {
    path: 'kj/g2resources/ReverseStringMapDemo.kt',
    text: fixture('src/main/kotlin/com/example/kj/g2resources/ReverseStringMapDemo.kt'),
  },
];

describe.skipIf(!mod)('KJ-021 — comptage sur fixtures réelles', () => {
  it('unused_promo_banner → 0', () => {
    expect(mod.countResourceUsages('string', 'unused_promo_banner', sources())).toBe(0);
  });

  it('banner_caption → 1 (android:text)', () => {
    expect(mod.countResourceUsages('string', 'banner_caption', sources())).toBe(1);
  });

  it('legacy_subtitle → 0 (tools:text ignoré)', () => {
    expect(mod.countResourceUsages('string', 'legacy_subtitle', sources())).toBe(0);
  });

  it('banner_backdrop → 1 (ref res→res android:background)', () => {
    expect(mod.countResourceUsages('color', 'banner_backdrop', sources())).toBe(1);
  });

  it('battle_cry → 2 (écran + classe)', () => {
    expect(mod.countResourceUsages('string', 'battle_cry', sources())).toBe(2);
  });

  it('préfixe piégeux : battle ne matche pas battle_cry', () => {
    expect(
      mod.countResourceUsages('string', 'battle', [
        { path: 'a.kt', text: 'val x = R.string.battle_cry' },
      ])
    ).toBe(0);
  });
});
