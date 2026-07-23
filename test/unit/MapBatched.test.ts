/**
 * mapBatched — concurrence bornée pour les scans d'activation
 *
 * MB-1  Tout est traité, dans l'ordre des lots
 * MB-2  Jamais plus de batchSize en vol simultanément
 * MB-3  Liste vide → no-op ; liste < batchSize → un seul lot
 */
import { describe, it, expect } from 'vitest';
import { mapBatched } from '../../src/util/batched';

describe('mapBatched', () => {
  it('MB-1 — traite tous les items', async () => {
    const seen: number[] = [];
    await mapBatched([1, 2, 3, 4, 5], async n => { seen.push(n); }, 2);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('MB-2 — la concurrence ne dépasse jamais batchSize', async () => {
    let inFlight = 0, peak = 0;
    await mapBatched(Array.from({ length: 40 }, (_, i) => i), async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
    }, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('MB-3 — vide et petit', async () => {
    await mapBatched([], async () => { throw new Error('never'); });
    const seen: number[] = [];
    await mapBatched([7], async n => { seen.push(n); }, 16);
    expect(seen).toEqual([7]);
  });
});
