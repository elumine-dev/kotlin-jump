import { describe, it, expect } from 'vitest';
import { analyzeLifecyclePairs } from '../../../src/providers/LifecyclePairingProvider';

/** KJ-016 — tentatives de casse au-delà du contrat. */

describe('KJ-016 adversarial', () => {
  it('libération dans le MAUVAIS miroir : orphelin quand même', () => {
    const text = `
      class A : DemoActivity() {
        override fun onCreate() { wakeLock.acquire() }
        override fun onStop() { wakeLock.release() }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    // acquire dans onCreate attend release dans onDestroy, pas onStop.
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].expectedIn).toBe('onDestroy');
  });

  it('deux ressources, une seule libérée : un seul orphelin, le bon', () => {
    const text = `
      class A {
        override fun onStart() {
          registerReceiver(alpha, filter)
          registerReceiver(beta, filter)
        }
        override fun onStop() { unregisterReceiver(alpha) }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].resource).toBe('beta');
  });

  it('indirection à DEUX niveaux : orphelin (contrat = 1 niveau)', () => {
    const text = `
      class A {
        override fun onCreate() { wakeLock.acquire() }
        override fun onDestroy() { level1() }
        fun level1() { level2() }
        fun level2() { wakeLock.release() }
      }
      `;
    expect(analyzeLifecyclePairs(text).orphans).toHaveLength(1);
  });

  it('subscribe fermé par unsubscribe (alternative à dispose) : complet', () => {
    const text = `
      class A {
        override fun onResume() { bus.subscribe(handler) }
        override fun onPause() { bus.unsubscribe(handler) }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(0);
    expect(r.complete).toHaveLength(1);
  });

  it('acquisition HORS méthode de cycle de vie : ignorée (pas notre affaire)', () => {
    const text = `
      class A {
        fun connect() { registerReceiver(r, f) }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(0);
    expect(r.complete).toHaveLength(0);
  });

  it('ligne de l’orphelin exacte pour le squiggly', () => {
    const text = ['class A {', '  override fun onResume() {', '    requestLocationUpdates(gps)', '  }', '}'].join('\n');
    expect(analyzeLifecyclePairs(text).orphans[0].line).toBe(2);
  });

  it('BUG-HUNT-23 : bindService/unbindService appariés sur la CONNEXION (2ᵉ argument)', () => {
    const text = `
      class A {
        override fun onStart() { bindService(intent, connection, flags) }
        override fun onStop() { unbindService(connection) }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(0);
    expect(r.complete).toContainEqual({ open: 'onStart', close: 'onStop', resource: 'connection' });
  });

  it('BUG-HUNT-23b : bindService jamais unbind → orphelin sur la connexion', () => {
    const text = `
      class A {
        override fun onStart() { bindService(intent, connection, flags) }
        override fun onStop() { }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].resource).toBe('connection');
  });

  it('BUG-HUNT-3 : this.resource apparié avec resource (pas de faux orphelin)', () => {
    const text = `
      class A {
        override fun onStart() { registerReceiver(this.batteryReceiver, filter) }
        override fun onStop() { unregisterReceiver(batteryReceiver) }
      }
      `;
    const r = analyzeLifecyclePairs(text);
    expect(r.orphans).toHaveLength(0);
    expect(r.complete).toHaveLength(1);
    expect(r.complete[0].resource).toBe('batteryReceiver');
  });
});
