import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-018 — Reverse String Map. CONTRAT :
 *   export function findDisplaySites(resName: string, files: { path: string; text: string }[]): {
 *     enclosing: string;          // composable ou classe englobante
 *     isComposable: boolean;
 *   }[]
 */
const mod: any = await importOrNull('src/providers/StringXmlHoverProvider');

const files = () => [
  {
    path: 'g3navigation/ScreensDemo.kt',
    text: fixture('src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt'),
  },
  {
    path: 'g2resources/ReverseStringMapDemo.kt',
    text: fixture('src/main/kotlin/com/example/kj/g2resources/ReverseStringMapDemo.kt'),
  },
];

describe.skipIf(!mod)('KJ-018 — remontée aux écrans', () => {
  it('battle_cry → BattleRouteScreen (composable) + BattleAnnouncer (classe)', () => {
    const sites = mod.findDisplaySites('battle_cry', files());
    expect(sites).toContainEqual({ enclosing: 'BattleRouteScreen', isComposable: true });
    expect(sites).toContainEqual({ enclosing: 'BattleAnnouncer', isComposable: false });
  });

  it('title_pokedex → PokedexRouteScreen uniquement', () => {
    const sites = mod.findDisplaySites('title_pokedex', files());
    expect(sites).toEqual([{ enclosing: 'PokedexRouteScreen', isComposable: true }]);
  });

  it('string jamais affichée → liste vide', () => {
    expect(mod.findDisplaySites('unused_promo_banner', files())).toEqual([]);
  });
});
