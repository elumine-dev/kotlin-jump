import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-016 — Lifecycle Pairing. CONTRAT :
 *   export function analyzeLifecyclePairs(text: string): {
 *     complete: { open: string; close: string; resource: string }[];
 *     orphans: { open: string; expectedIn: string; resource: string; line: number }[];
 *   }
 */
const mod: any = await importOrNull('src/providers/LifecyclePairingProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g4runtime/LifecyclePairingDemo.kt');

describe.skipIf(!mod)('KJ-016 — fixture BattleActivity', () => {
  const result = () => mod.analyzeLifecyclePairs(demo());

  it('registerReceiver/unregisterReceiver onStart↔onStop : paire complète', () => {
    expect(
      result().complete.some(
        (p: any) => p.resource === 'batteryReceiver' && p.open === 'onStart' && p.close === 'onStop'
      )
    ).toBe(true);
  });

  it('requestLocationUpdates sans removeUpdates : orphelin attendu dans onPause', () => {
    const orphan = result().orphans.find((o: any) => o.resource === 'gpsListener');
    expect(orphan).toBeTruthy();
    expect(orphan.expectedIn).toBe('onPause');
  });

  it('wakeLock relâché via helper (1 niveau d’indirection) : PAS orphelin', () => {
    expect(result().orphans.some((o: any) => o.resource === 'wakeLock')).toBe(false);
  });

  it('un seul orphelin au total dans la fixture', () => {
    expect(result().orphans).toHaveLength(1);
  });

  it('classe sans méthode de cycle de vie → rien, pas de crash', () => {
    const r = mod.analyzeLifecyclePairs('class Plain { fun x() {} }');
    expect(r.complete).toEqual([]);
    expect(r.orphans).toEqual([]);
  });
});
