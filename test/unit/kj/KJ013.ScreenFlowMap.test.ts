import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-013 — Screen Flow Map. CONTRAT :
 *   export function parseNavigation(text: string, constants: Map<string, string>): {
 *     nodes: { route: string; composable?: string; dynamic?: boolean; graph?: string }[];
 *     edges: { from: string; to: string }[];
 *     deepLinks: { pattern: string; route: string }[];
 *   }
 *   export function findOrphans(parsed: ReturnType): string[]
 */
const mod: any = await importOrNull('src/indexer/NavigationIndex');

const CONSTANTS = new Map([
  ['Routes.POKEDEX', 'pokedex'],
  ['Routes.TEAM', 'team'],
  ['Routes.BATTLE', 'battle/{pokemonId}'],
  ['Routes.SETTINGS_GRAPH', 'settings_graph'],
  ['Routes.SETTINGS_HOME', 'settings/home'],
  ['Routes.SETTINGS_ABOUT', 'settings/about'],
]);

const parsed = () =>
  mod.parseNavigation(fixture('src/main/kotlin/com/example/kj/g3navigation/NavGraphDemo.kt'), CONSTANTS);

describe.skipIf(!mod)('KJ-013 — fixture NavGraphDemo réelle', () => {
  it('tous les écrans déclarés sont des nœuds', () => {
    const routes = parsed().nodes.map((n: any) => n.route);
    for (const r of ['pokedex', 'team', 'battle/{pokemonId}', 'settings/home', 'settings/about', 'orphan']) {
      expect(routes, `nœud manquant: ${r}`).toContain(r);
    }
  });

  it('les navigate() textuels ET par constante donnent des arêtes', () => {
    const edges = parsed().edges.map((e: any) => `${e.from}→${e.to}`);
    expect(edges).toContain('pokedex→battle/{pokemonId}'); // navigate("battle/$id") normalisé
    expect(edges).toContain('pokedex→team');                // navigate(Routes.TEAM)
    expect(edges).toContain('team→battle/{pokemonId}');     // navigate("battle/25") normalisé
    expect(edges).toContain('settings/home→settings/about');
  });

  it('le deeplink est rattaché à sa route', () => {
    expect(parsed().deepLinks).toContainEqual({
      pattern: 'pokedemo://battle/{pokemonId}',
      route: 'battle/{pokemonId}',
    });
  });

  it('le graphe imbriqué est étiqueté', () => {
    const home = parsed().nodes.find((n: any) => n.route === 'settings/home');
    expect(home.graph).toBe('settings_graph');
  });

  it('la route concaténée devient un nœud dynamic, sans fausse arête', () => {
    const dyn = parsed().nodes.filter((n: any) => n.dynamic);
    expect(dyn).toHaveLength(1);
  });

  it('orphan est détecté orphelin, pokedex (start) ne l’est pas', () => {
    const orphans = mod.findOrphans(parsed());
    expect(orphans).toContain('orphan');
    expect(orphans).not.toContain('pokedex');
    expect(orphans).not.toContain('battle/{pokemonId}'); // atteint par 2 arêtes + deeplink
  });
});
