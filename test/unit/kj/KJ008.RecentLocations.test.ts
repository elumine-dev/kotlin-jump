import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-008 — Recent locations. CONTRAT :
 *   export function buildRecentLocationItems(
 *     entries: { file: string; line: number; timestamp: number }[],
 *     excerptOf: (file: string, line: number) => string,
 *   ): { label: string; description: string; detail: string }[]
 *   // Tri antichronologique, dédoublonnage même fichier+ligne (±2 lignes),
 *   // extrait de code en detail.
 */
const mod: any = await importOrNull('src/commands/recentLocations');

const excerpt = (file: string, line: number) => `code@${file}:${line}`;

describe.skipIf(!mod)('KJ-008 — Recent locations', () => {
  it('tri antichronologique', () => {
    const items = mod.buildRecentLocationItems(
      [
        { file: 'A.kt', line: 10, timestamp: 100 },
        { file: 'B.kt', line: 5, timestamp: 300 },
        { file: 'C.kt', line: 1, timestamp: 200 },
      ],
      excerpt
    );
    expect(items.map((i: any) => i.label.split(':')[0])).toEqual(['B.kt', 'C.kt', 'A.kt']);
  });

  it('dédoublonne les visites voisines du même fichier (±2 lignes)', () => {
    const items = mod.buildRecentLocationItems(
      [
        { file: 'A.kt', line: 10, timestamp: 100 },
        { file: 'A.kt', line: 11, timestamp: 200 },
      ],
      excerpt
    );
    expect(items).toHaveLength(1);
    // Spec 2026-07-25 : affichage 1-based — ligne interne 11 → « :12 ».
    expect(items[0].label).toContain('12');
  });

  it('l’extrait de code est attaché', () => {
    const items = mod.buildRecentLocationItems([{ file: 'A.kt', line: 7, timestamp: 1 }], excerpt);
    expect(items[0].detail).toBe('code@A.kt:7');
  });

  it('liste vide → aucune entrée, pas de crash', () => {
    expect(mod.buildRecentLocationItems([], excerpt)).toEqual([]);
  });
});
