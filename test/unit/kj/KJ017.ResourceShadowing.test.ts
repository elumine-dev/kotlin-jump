import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-017 — Resource shadowing. CONTRAT :
 *   export function resolveWinner(defs: {
 *     module: string; moduleType: 'app' | 'library';
 *     sourceSet: string;            // 'main' | flavor
 *     folder: string;               // 'values' | 'values-fr' | …
 *     value: string;
 *   }[]): { winner: number; shadowed: number[]; localeOverlays: number[] }
 */
const mod: any = await importOrNull('src/indexer/ResourcePriorityResolver');

describe.skipIf(!mod)('KJ-017 — priorités', () => {
  it('app > library', () => {
    const r = mod.resolveWinner([
      { module: 'feature-battle', moduleType: 'library', sourceSet: 'main', folder: 'values', value: '#FF0044' },
      { module: 'app', moduleType: 'app', sourceSet: 'main', folder: 'values', value: '#7F52FF' },
    ]);
    expect(r.winner).toBe(1);
    expect(r.shadowed).toEqual([0]);
  });

  it('flavor > main dans le même module', () => {
    const r = mod.resolveWinner([
      { module: 'app', moduleType: 'app', sourceSet: 'main', folder: 'values', value: 'a' },
      { module: 'app', moduleType: 'app', sourceSet: 'premium', folder: 'values', value: 'b' },
    ]);
    expect(r.winner).toBe(1);
  });

  it('values-fr est un overlay de locale, PAS un ombrage', () => {
    const r = mod.resolveWinner([
      { module: 'app', moduleType: 'app', sourceSet: 'main', folder: 'values', value: 'Hello' },
      { module: 'app', moduleType: 'app', sourceSet: 'main', folder: 'values-fr', value: 'Bonjour' },
    ]);
    expect(r.shadowed).toEqual([]);
    expect(r.localeOverlays).toEqual([1]);
  });

  it('définition unique → aucun ombrage', () => {
    const r = mod.resolveWinner([
      { module: 'feature-battle', moduleType: 'library', sourceSet: 'main', folder: 'values', value: '#FFD700' },
    ]);
    expect(r.winner).toBe(0);
    expect(r.shadowed).toEqual([]);
  });
});
