import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('RunEvents — pub/sub plumbing', () => {
  it('delivers the exact payload to a subscriber', async () => {
    const { onRunSuccess, _emitRunSuccess } = await import('../../src/android/RunEvents');
    const received: any[] = [];
    const sub = onRunSuccess(ev => received.push(ev));
    _emitRunSuccess({ device: 'emulator-5554', packageName: 'com.example.app',
      projectRoot: '/work', at: 1_700_000_000_000 });
    sub.dispose();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      device: 'emulator-5554', packageName: 'com.example.app',
      projectRoot: '/work', at: 1_700_000_000_000,
    });
  });

  it('broadcasts to multiple subscribers', async () => {
    const { onRunSuccess, _emitRunSuccess } = await import('../../src/android/RunEvents');
    const a: any[] = [];
    const b: any[] = [];
    const subA = onRunSuccess(ev => a.push(ev));
    const subB = onRunSuccess(ev => b.push(ev));
    _emitRunSuccess({ device: 'X', packageName: 'pkg', projectRoot: '/', at: 0 });
    subA.dispose(); subB.dispose();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('disposed subscribers no longer receive events', async () => {
    const { onRunSuccess, _emitRunSuccess } = await import('../../src/android/RunEvents');
    const received: any[] = [];
    const sub = onRunSuccess(ev => received.push(ev));
    _emitRunSuccess({ device: 'A', packageName: 'p', projectRoot: '/', at: 1 });
    sub.dispose();
    _emitRunSuccess({ device: 'B', packageName: 'p', projectRoot: '/', at: 2 });

    expect(received).toHaveLength(1);
    expect(received[0].device).toBe('A');
  });

});
