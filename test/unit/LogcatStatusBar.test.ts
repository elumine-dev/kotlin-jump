import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

// Tracker for the most recently created status-bar item so tests can assert.
let lastItem: any;

beforeEach(() => {
  vi.spyOn(vscodeMock.window, 'createStatusBarItem').mockImplementation(() => {
    lastItem = {
      text: '',
      tooltip: undefined as any,
      name: '',
      command: '',
      color: undefined as any,
      backgroundColor: undefined as any,
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    return lastItem;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  lastItem = undefined;
});

import { formatThroughput, LogcatStatusBar } from '../../src/logcat/LogcatStatusBar';

function fakeCfg(overrides: Partial<{ enabled: boolean; statusBar: boolean; pill: boolean }> = {}) {
  return () => ({
    get<T>(key: string, fallback?: T): T {
      if (key === 'logcat.enabled')         return (overrides.enabled        ?? true) as unknown as T;
      if (key === 'statusBarEnabled')        return (overrides.statusBar      ?? true) as unknown as T;
      if (key === 'logcat.statusBarPill')    return (overrides.pill           ?? true) as unknown as T;
      return fallback as T;
    },
  } as any);
}

describe('formatThroughput', () => {
  it('zero / negative / NaN yield "0/s"', () => {
    expect(formatThroughput(0)).toBe('0/s');
    expect(formatThroughput(-5)).toBe('0/s');
    expect(formatThroughput(NaN)).toBe('0/s');
  });
  it('< 1k → integer', () => {
    expect(formatThroughput(1)).toBe('1/s');
    expect(formatThroughput(142)).toBe('142/s');
    expect(formatThroughput(999)).toBe('999/s');
  });
  it('1k-10k → 1 decimal k', () => {
    expect(formatThroughput(1_000)).toBe('1.0k/s');
    expect(formatThroughput(1_200)).toBe('1.2k/s');
    expect(formatThroughput(9_999)).toBe('10.0k/s');
  });
  it('10k-1M → integer k', () => {
    expect(formatThroughput(12_000)).toBe('12k/s');
    expect(formatThroughput(123_456)).toBe('123k/s');
  });
  it('>= 1M → 1 decimal M', () => {
    expect(formatThroughput(1_000_000)).toBe('1.0M/s');
    expect(formatThroughput(2_500_000)).toBe('2.5M/s');
  });
});

describe('LogcatStatusBar — visibility gates', () => {
  it('hidden when no session AND no error', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    expect(lastItem.hide).toHaveBeenCalled();
    pill.dispose();
  });

  it('hidden when kotlinJump.logcat.enabled = false', () => {
    const pill = new LogcatStatusBar(fakeCfg({ enabled: false }));
    pill.setState({ hasSession: true, throughputPerSec: 100 });
    expect(lastItem.hide).toHaveBeenCalled();
    pill.dispose();
  });

  it('hidden when kotlinJump.statusBarEnabled = false', () => {
    const pill = new LogcatStatusBar(fakeCfg({ statusBar: false }));
    pill.setState({ hasSession: true, throughputPerSec: 100 });
    expect(lastItem.hide).toHaveBeenCalled();
    pill.dispose();
  });

  it('hidden when kotlinJump.logcat.statusBarPill = false', () => {
    const pill = new LogcatStatusBar(fakeCfg({ pill: false }));
    pill.setState({ hasSession: true, throughputPerSec: 100 });
    expect(lastItem.hide).toHaveBeenCalled();
    pill.dispose();
  });

  it('shown when hasSession + all toggles true', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true });
    expect(lastItem.show).toHaveBeenCalled();
    pill.dispose();
  });
});

describe('LogcatStatusBar — state machine', () => {
  it('Idle: hasSession=true, throughput=0 → "ready" with circle-outline', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true });
    expect(lastItem.text).toContain('circle-outline');
    expect(lastItem.text).toContain('ready');
    expect(lastItem.backgroundColor).toBeUndefined();
    pill.dispose();
  });

  it('Stream: throughput > 0 → circle-filled with terminal.ansiGreen color', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, throughputPerSec: 142 });
    expect(lastItem.text).toContain('circle-filled');
    expect(lastItem.text).toContain('142/s');
    expect(lastItem.color).toBeDefined();
    pill.dispose();
  });

  it('PausedRn: paused=true → debug-pause icon, no green color', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, paused: true, throughputPerSec: 0 });
    expect(lastItem.text).toContain('debug-pause');
    expect(lastItem.text).toContain('paused');
    expect(lastItem.color).toBeUndefined();
    pill.dispose();
  });

  it('Stopped: hasSession=true, streaming=false → debug-stop icon (was: pill went silently stale after kotlinJump.logcat.stop)', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, streaming: false, throughputPerSec: 0 });
    expect(lastItem.text).toContain('debug-stop');
    expect(lastItem.text).toContain('stopped');
    expect(lastItem.backgroundColor).toBeUndefined();
    pill.dispose();
  });

  it('Stopped wins over Pressure — a stale buffer-pressure warning would be misleading once nothing is running', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, streaming: false, bufferUsed: 95, bufferCap: 100 });
    expect(lastItem.text).toContain('stopped');
    expect(lastItem.text).not.toContain('warning');
    pill.dispose();
  });

  it('Pressure: bufferUsed/bufferCap > 0.80 → warning icon + warning bg', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, throughputPerSec: 100, bufferUsed: 85, bufferCap: 100 });
    expect(lastItem.text).toContain('warning');
    expect(lastItem.text).toContain('85% buf');
    expect(lastItem.backgroundColor).toBeDefined();
    pill.dispose();
  });

  it('Error: error.at recent → red bg, error icon', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, error: { message: 'adb died', at: Date.now() } });
    expect(lastItem.text).toContain('error');
    expect(lastItem.text).toContain('stream error');
    expect(lastItem.backgroundColor).toBeDefined();
    pill.dispose();
  });

  it('Error wins over Pressure', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({
      hasSession: true, throughputPerSec: 100, bufferUsed: 95, bufferCap: 100,
      error: { message: 'x', at: Date.now() },
    });
    expect(lastItem.text).toContain('stream error');
    pill.dispose();
  });
});

describe('LogcatStatusBar — error decay', () => {
  it('clears error after 30s and refreshes UI back to streaming', async () => {
    vi.useFakeTimers();
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, throughputPerSec: 100,
      error: { message: 'oops', at: Date.now() } });
    expect(lastItem.text).toContain('stream error');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastItem.text).not.toContain('stream error');
    expect(lastItem.text).toContain('100/s');
    pill.dispose();
    vi.useRealTimers();
  });

  it('a fresh error before decay finishes resets the timer (no flicker)', async () => {
    vi.useFakeTimers();
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({ hasSession: true, error: { message: 'first', at: Date.now() } });

    await vi.advanceTimersByTimeAsync(20_000);
    pill.setState({ error: { message: 'second', at: Date.now() } });

    // 15 s past the FIRST error's mark — but the decay should now key off the SECOND.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(lastItem.text).toContain('stream error');

    await vi.advanceTimersByTimeAsync(20_000);  // total > 30 s past second
    expect(lastItem.text).not.toContain('stream error');
    pill.dispose();
    vi.useRealTimers();
  });
});

describe('LogcatStatusBar — tooltip', () => {
  it('tooltip is a MarkdownString containing device, package, buffer, throughput', () => {
    const pill = new LogcatStatusBar(fakeCfg());
    pill.setState({
      hasSession: true,
      device: { serial: 'emulator-5554', model: 'Pixel 8' },
      pkg: 'com.example.app',
      bufferUsed: 14_812,
      bufferCap: 100_000,
      throughputPerSec: 1_200,
    });
    const tip: any = lastItem.tooltip;
    expect(tip).toBeDefined();
    const md: string = tip.value ?? String(tip);
    expect(md).toContain('Kotlin Jump — Logcat');
    expect(md).toContain('Pixel 8');
    expect(md).toContain('com.example.app');
    expect(md).toContain('14,812');
    expect(md).toContain('100,000');
    expect(md).toContain('1.2k/s');
    pill.dispose();
  });
});
