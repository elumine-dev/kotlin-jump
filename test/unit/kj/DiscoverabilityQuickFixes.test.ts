import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Balayage ampoule (Kevin, 25/07). CONTRAT :
 *   export function buildReleaseCall(line, open, close, resource): string
 *   export function nullAssertionRewrites(lineText): { title, find, replace } | null
 */
const mod: any = await importOrNull('src/providers/DiscoverabilityQuickFixes');

describe.skipIf(!mod)('Discoverability quick fixes — helpers purs', () => {
  it('release en forme méthode quand l\'acquisition est resource.open()', () => {
    expect(mod.buildReleaseCall('        wakeLock.acquire()', 'acquire', 'release', 'wakeLock'))
      .toBe('wakeLock.release()');
  });

  it('release en forme fonction quand l\'acquisition est open(resource)', () => {
    expect(mod.buildReleaseCall(
      '        requestLocationUpdates(gpsListener)',
      'requestLocationUpdates', 'removeUpdates', 'gpsListener',
    )).toBe('removeUpdates(gpsListener)');
  });

  it('unregisterReceiver(x) pour registerReceiver(x, filter)', () => {
    expect(mod.buildReleaseCall(
      '        registerReceiver(batteryReceiver, IntentFilter("A"))',
      'registerReceiver', 'unregisterReceiver', 'batteryReceiver',
    )).toBe('unregisterReceiver(batteryReceiver)');
  });

  it('x!!.foo devient un safe call', () => {
    const r = mod.nullAssertionRewrites('        val name = pokemon!!.name');
    expect(r).not.toBeNull();
    expect(r.find).toBe('pokemon!!.');
    expect(r.replace).toBe('pokemon?.');
  });

  it('x!! nu devient requireNotNull(x)', () => {
    const r = mod.nullAssertionRewrites('        val p = pokemon!!');
    expect(r.find).toBe('pokemon!!');
    expect(r.replace).toBe('requireNotNull(pokemon)');
  });

  it('récepteur pointé : seul le dernier segment est réécrit en safe call', () => {
    const r = mod.nullAssertionRewrites('        team.leader!!.attack()');
    expect(r.find).toBe('team.leader!!.');
    expect(r.replace).toBe('team.leader?.');
  });

  it('ligne sans !! : aucune action', () => {
    expect(mod.nullAssertionRewrites('        val ok = pokemon?.name')).toBeNull();
  });
});
