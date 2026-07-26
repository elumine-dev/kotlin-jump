import { describe, it, expect } from 'vitest';
import { resolveWinner } from '../../../src/indexer/ResourcePriorityResolver';
import { definitionFromPath } from '../../../src/providers/ResourceShadowingProvider';

/** KJ-017 — tentatives de casse au-delà du contrat. */

const def = (over: Partial<Parameters<typeof resolveWinner>[0][number]>) => ({
  module: 'app',
  moduleType: 'app' as const,
  sourceSet: 'main',
  folder: 'values',
  value: 'x',
  ...over,
});

describe('KJ-017 adversarial — resolveWinner', () => {
  it('flavor de library PERD contre main de app', () => {
    const r = resolveWinner([
      def({ module: 'lib', moduleType: 'library', sourceSet: 'premium' }),
      def({}),
    ]);
    expect(r.winner).toBe(1);
  });

  it('toutes overlays : pas de shadowing, winner par défaut, pas de crash', () => {
    const r = resolveWinner([
      def({ folder: 'values-fr' }),
      def({ folder: 'values-de' }),
    ]);
    expect(r.shadowed).toEqual([]);
    expect(r.localeOverlays).toEqual([0, 1]);
  });

  it('égalité parfaite : la première gagne (stable)', () => {
    const r = resolveWinner([def({ module: 'a' }), def({ module: 'b' })]);
    expect(r.winner).toBe(0);
    expect(r.shadowed).toEqual([1]);
  });

  it('values-night est un overlay de config, pas un concurrent', () => {
    const r = resolveWinner([def({}), def({ folder: 'values-night' })]);
    expect(r.shadowed).toEqual([]);
    expect(r.localeOverlays).toEqual([1]);
  });
});

describe('KJ-017 adversarial — doublons intra-dossier (cas trouvé par Kevin)', () => {
  it('deux définitions même module/sourceSet/dossier : le resolver les départage quand même (stable)', () => {
    // colors.xml et colors_refs.xml du même values/ définissent tous deux
    // `primary` : le resolver reste stable (premier gagne), le PROVIDER les
    // étiquette « dupliquée » plutôt qu'« ombragée ».
    const r = resolveWinner([
      def({ value: '#7F52FF' }),
      def({ value: '#FF0000' }),
      def({ module: 'feature-battle', moduleType: 'library', value: '#FF0044' }),
    ]);
    expect(r.winner).toBe(0);
    expect(r.shadowed).toEqual([1, 2]);
  });
});

describe('KJ-017 adversarial — definitionFromPath', () => {
  it('module racine → app', () => {
    const d = definitionFromPath(
      'file:///dev/kotlin-jump-demo/src/main/res/values/colors.xml', '#FFF', 'kotlin-jump-demo',
    );
    expect(d).toEqual({
      module: 'app', moduleType: 'app', sourceSet: 'main', folder: 'values', value: '#FFF',
    });
  });

  it('sous-module → library, flavor détecté', () => {
    const d = definitionFromPath(
      'file:///dev/kotlin-jump-demo/feature-battle/src/premium/res/values/colors.xml',
      '#F00', 'kotlin-jump-demo',
    );
    expect(d).toEqual({
      module: 'feature-battle', moduleType: 'library', sourceSet: 'premium',
      folder: 'values', value: '#F00',
    });
  });

  it('chemin sans res/ → null, pas de crash', () => {
    expect(definitionFromPath('file:///x/src/main/kotlin/A.kt', 'v', 'x')).toBeNull();
  });
});
