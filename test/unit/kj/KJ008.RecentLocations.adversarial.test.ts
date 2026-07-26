import { describe, it, expect } from 'vitest';
import { buildRecentLocationItems } from '../../../src/commands/recentLocations';

/** KJ-008 — tentatives de casse au-delà du contrat. */

const noExcerpt = () => '';

describe('KJ-008 adversarial', () => {
  it('même fichier, lignes éloignées de plus de 2 : les DEUX gardées', () => {
    const items = buildRecentLocationItems(
      [
        { file: 'A.kt', line: 10, timestamp: 100 },
        { file: 'A.kt', line: 50, timestamp: 200 },
      ],
      noExcerpt
    );
    expect(items).toHaveLength(2);
  });

  it('fichiers DIFFÉRENTS à la même ligne : jamais dédoublonnés', () => {
    const items = buildRecentLocationItems(
      [
        { file: 'A.kt', line: 7, timestamp: 100 },
        { file: 'B.kt', line: 7, timestamp: 200 },
      ],
      noExcerpt
    );
    expect(items).toHaveLength(2);
  });

  it('timestamps identiques : pas de crash, les deux présentes', () => {
    const items = buildRecentLocationItems(
      [
        { file: 'A.kt', line: 1, timestamp: 500 },
        { file: 'B.kt', line: 9, timestamp: 500 },
      ],
      noExcerpt
    );
    expect(items).toHaveLength(2);
  });

  it('chemin complet raccourci dans le label, gardé en description', () => {
    const items = buildRecentLocationItems(
      [{ file: 'file:///src/ui/Pokedex.kt', line: 3, timestamp: 1 }],
      noExcerpt
    );
    expect(items[0].label).toBe('Pokedex.kt:4');
    expect(items[0].description).toContain('/src/ui/');
  });

  it('cascade de voisines : chaque gardée bloque ses ±2 lignes', () => {
    // lignes 10,11,12,13 : 13 (plus récente) garde, 11/12 collent à 13 ou 11…
    const items = buildRecentLocationItems(
      [
        { file: 'A.kt', line: 10, timestamp: 1 },
        { file: 'A.kt', line: 11, timestamp: 2 },
        { file: 'A.kt', line: 12, timestamp: 3 },
        { file: 'A.kt', line: 13, timestamp: 4 },
      ],
      noExcerpt
    );
    // 13 gardée ; 12/11 dans ±2 de 13 → absorbées ; 10 dans ±2 de 11 ? 11 absente,
    // mais |13-10|=3 > 2 → 10 gardée.
    expect(items.map(i => i.label)).toEqual(['A.kt:14', 'A.kt:11']);
  });

  it('BUG-HUNT-13 : lignes affichées en 1-based (les éditeurs comptent depuis 1)', () => {
    // line interne 0-based = ligne 7 → l'humain doit lire « :8 ».
    const items = buildRecentLocationItems(
      [{ file: 'A.kt', line: 7, timestamp: 1 }],
      () => ''
    );
    expect(items[0].label).toBe('A.kt:8');
  });

  it('excerptOf qui jette ne casse pas le popup', () => {
    const boom = () => {
      throw new Error('gone');
    };
    expect(() =>
      buildRecentLocationItems([{ file: 'A.kt', line: 1, timestamp: 1 }], boom as any)
    ).toThrow(); // le contrat n'absorbe PAS : c'est le command handler qui protège
  });
});
