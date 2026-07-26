import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-015 — Compose Outline Tree. CONTRAT :
 *   export function buildOutline(text: string, rootComposable: string, maxDepth?: number): {
 *     name: string; children: Node[]; branch?: string; loop?: boolean; cycle?: boolean;
 *   }
 */
const mod: any = await importOrNull('src/providers/ComposeOutlineProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g3navigation/OutlineTreeDemo.kt');

const flatten = (node: any, acc: string[] = []): string[] => {
  acc.push(node.name);
  for (const c of node.children ?? []) flatten(c, acc);
  return acc;
};

describe.skipIf(!mod)('KJ-015 — fixture BattleDashboard', () => {
  const tree = () => mod.buildOutline(demo(), 'BattleDashboard');

  it('la hiérarchie descend dans les composables du fichier', () => {
    const names = flatten(tree());
    for (const n of ['Column', 'TrainerBadge', 'Row', 'HpBar', 'RosterList', 'PokemonSlot']) {
      expect(names, `nœud manquant: ${n}`).toContain(n);
    }
  });

  it('les branches if/else sont étiquetées', () => {
    const names = flatten(tree());
    expect(names).toContain('LoadingPanel');
    expect(names).toContain('ArenaPanel');
    const loading = JSON.stringify(tree());
    expect(loading).toContain('"branch"');
  });

  it('les 3 branches du when apparaissent', () => {
    const names = flatten(tree());
    expect(names).toContain('SunnyBanner');
    expect(names).toContain('RainBanner');
  });

  it('la boucle forEach marque PokemonSlot comme répété', () => {
    const raw = JSON.stringify(tree());
    expect(raw).toMatch(/"loop":\s*true/);
  });

  it('la récursion RematchTree est coupée (cycle marqué, pas de boucle infinie)', () => {
    const t = mod.buildOutline(demo(), 'RematchTree');
    expect(JSON.stringify(t)).toMatch(/"cycle":\s*true/);
  });

  it('les feuilles de lib (Text, Button) ne sont pas expansées', () => {
    const textNode = (function find(n: any): any {
      if (n.name === 'Text') return n;
      for (const c of n.children ?? []) { const f = find(c); if (f) return f; }
      return null;
    })(tree());
    expect(textNode?.children ?? []).toHaveLength(0);
  });

  it('maxDepth respecté', () => {
    const shallow = mod.buildOutline(demo(), 'BattleDashboard', 1);
    const names = flatten(shallow);
    expect(names).not.toContain('HpBar'); // profondeur 3
  });
});
