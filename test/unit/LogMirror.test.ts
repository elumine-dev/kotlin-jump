import { describe, it, expect } from 'vitest';
import { LogMirror, ALL_LEVELS, type MirrorFilterState } from '../../media/logcat/logMirror';
import type { LogEntry, LogLevel } from '../../src/logcat/messages';

// Adversarial + perf coverage for the webview mirror. This module replaces a
// plain `Array` evicted with `.shift()` (O(n) per push once full) — the exact
// anti-pattern already documented and fixed once on the host side in
// LogcatRingBuffer.ts. These tests exist because the bug shipped silently: this
// file had ZERO test coverage before this fix.

function mk(seq: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    seq, ts: 0, tsDisplay: '00:00:00.000', pid: 0, tid: 0,
    level: 'I', tag: 'App', message: `line ${seq}`,
    ...overrides,
  };
}

function noFilter(): MirrorFilterState {
  return { levels: new Set(ALL_LEVELS), hasTag: false, tagLow: '', hasSearch: false, searchLow: '' };
}
function searchFilter(q: string): MirrorFilterState {
  return { levels: new Set(ALL_LEVELS), hasTag: false, tagLow: '', hasSearch: true, searchLow: q.toLowerCase() };
}
function tagOnlyFilter(t: string): MirrorFilterState {
  return { levels: new Set(ALL_LEVELS), hasTag: true, tagLow: t.toLowerCase(), hasSearch: false, searchLow: '' };
}
function levelsFilter(levels: LogLevel[]): MirrorFilterState {
  return { levels: new Set(levels), hasTag: false, tagLow: '', hasSearch: false, searchLow: '' };
}

/** rows[startSeq, startSeq+n) — every `matchEvery`-th row (by absolute seq) contains 'needle'. */
function makeRows(startSeq: number, n: number, matchEvery = 1): LogEntry[] {
  const rows: LogEntry[] = [];
  for (let i = 0; i < n; i++) {
    const seq = startSeq + i;
    const isMatch = matchEvery === 1 || seq % matchEvery === 0;
    rows.push(mk(seq, { message: isMatch ? 'needle found here' : 'nothing of interest', tag: isMatch ? 'Target' : 'Other' }));
  }
  return rows;
}

describe('LogMirror — correctness', () => {
  it('displayCount/entryAt mirror the ring 1:1 with no filter', () => {
    const mirror = new LogMirror(10);
    mirror.append(makeRows(0, 5), noFilter());
    expect(mirror.displayCount()).toBe(5);
    expect(mirror.entryAt(0)!.seq).toBe(0);
    expect(mirror.entryAt(4)!.seq).toBe(4);
    expect(mirror.entryAt(5)).toBeUndefined();
  });

  it('append() incrementally filters only the new batch when a filter is already active', () => {
    const mirror = new LogMirror(100);
    mirror.rebuild(searchFilter('needle')); // activates the filter on an empty mirror
    mirror.append(makeRows(0, 10, 3), searchFilter('needle')); // matches at seq 0,3,6,9
    expect(mirror.displayCount()).toBe(4);
    expect(mirror.entryAt(0)!.seq).toBe(0);
    expect(mirror.entryAt(3)!.seq).toBe(9);
  });

  it('rebuild() matches a manual filter of the full ring contents', () => {
    const mirror = new LogMirror(50);
    mirror.append(makeRows(0, 50, 4), noFilter()); // no filter yet — fast path, nothing recorded
    mirror.rebuild(searchFilter('needle'));
    const expected = makeRows(0, 50, 4).filter(e => e.message.includes('needle')).map(e => e.seq);
    const actual: number[] = [];
    for (let i = 0; i < mirror.displayCount(); i++) actual.push(mirror.entryAt(i)!.seq);
    expect(actual).toEqual(expected);
  });

  it('tag-only filter matches manual filtering', () => {
    const mirror = new LogMirror(50);
    mirror.rebuild(tagOnlyFilter('target'));
    mirror.append(makeRows(0, 20, 5), tagOnlyFilter('target'));
    const expected = makeRows(0, 20, 5).filter(e => e.tag === 'Target').map(e => e.seq);
    const actual: number[] = [];
    for (let i = 0; i < mirror.displayCount(); i++) actual.push(mirror.entryAt(i)!.seq);
    expect(actual).toEqual(expected);
  });

  it('level filter matches manual filtering', () => {
    const mirror = new LogMirror(50);
    const rows = [mk(0, { level: 'E' }), mk(1, { level: 'I' }), mk(2, { level: 'E' }), mk(3, { level: 'W' })];
    mirror.rebuild(levelsFilter(['E']));
    mirror.append(rows, levelsFilter(['E']));
    expect(mirror.displayCount()).toBe(2);
    expect(mirror.entryAt(0)!.seq).toBe(0);
    expect(mirror.entryAt(1)!.seq).toBe(2);
  });

  it('never returns an entry whose seq has already been evicted from the ring (low match-rate trap)', () => {
    // The trap this guards against: a naive fixed-capacity "filtered" ring,
    // sized independently of the main ring, would fill ~20x slower than the
    // main ring here (only 1/20 rows match) and could retain seqs the main
    // ring has already evicted. Correctness requires purging in lockstep with
    // the main ring's oldest retained seq (see trimStale() in logMirror.ts).
    const cap = 100;
    const mirror = new LogMirror(cap);
    const filter = searchFilter('needle');
    mirror.rebuild(filter);
    const total = 1000;
    mirror.append(makeRows(0, total, 20), filter); // matches at seq 0,20,40,...980

    // Oldest raw entry still retained is seq (total - cap).
    const oldestRetainedSeq = total - cap;
    for (let i = 0; i < mirror.displayCount(); i++) {
      const e = mirror.entryAt(i)!;
      expect(e).toBeDefined();
      expect(e.seq).toBeGreaterThanOrEqual(oldestRetainedSeq);
      expect(e.message).toContain('needle');
    }
    // Sanity: matches within the retained window only — seq 900..980 step 20.
    expect(mirror.displayCount()).toBe(5);
  });

  it('resizeCapacity() mid-stream with an active filter forces a correct full rescan', () => {
    const mirror = new LogMirror(200);
    const filter = searchFilter('needle');
    mirror.rebuild(filter);
    mirror.append(makeRows(0, 200, 10), filter); // 20 matches, seq 0..190 step 10

    mirror.resizeCapacity(20, filter); // shrink hard — evicts a burst at once
    const oldestRetainedSeq = 200 - 20;
    for (let i = 0; i < mirror.displayCount(); i++) {
      const e = mirror.entryAt(i)!;
      expect(e.seq).toBeGreaterThanOrEqual(oldestRetainedSeq);
    }
  });

  it('hydrate() replaces the mirror wholesale and reapplies the current filter', () => {
    const mirror = new LogMirror(100);
    mirror.append(makeRows(0, 10), noFilter());
    const filter = searchFilter('needle');
    mirror.hydrate(makeRows(1000, 30, 3), filter);
    const expected = makeRows(1000, 30, 3).filter(e => e.message.includes('needle')).map(e => e.seq);
    const actual: number[] = [];
    for (let i = 0; i < mirror.displayCount(); i++) actual.push(mirror.entryAt(i)!.seq);
    expect(actual).toEqual(expected);
  });

  it('reset() clears everything and leaves no stale state for the next append', () => {
    const mirror = new LogMirror(50);
    mirror.rebuild(searchFilter('needle'));
    mirror.append(makeRows(0, 50, 5), searchFilter('needle'));
    mirror.reset();
    expect(mirror.displayCount()).toBe(0);
    expect(mirror.entryAt(0)).toBeUndefined();

    mirror.append(makeRows(0, 5), noFilter());
    expect(mirror.displayCount()).toBe(5);
  });
});

describe('LogMirror — perf (was Array.shift() + full O(n) rescan per append)', () => {
  it('sustains a full 100k-cap buffer under 500 flush ticks with an active filter, in bounded time', () => {
    const cap = 100_000;
    const mirror = new LogMirror(cap);
    const filter = searchFilter('needle');
    mirror.append(makeRows(0, cap, 7), noFilter()); // fill to cap, no filter yet
    mirror.rebuild(filter); // one real rescan, as a filter edit would trigger

    const start = performance.now();
    for (let tick = 0; tick < 500; tick++) {
      mirror.append(makeRows(cap + tick * 100, 100, 7), filter); // ~60Hz-style batch
    }
    const elapsed = performance.now() - start;
    // A naive full-buffer rescan per tick would be ~500 * 100_000 comparisons;
    // the incremental design only scans the 100-row batch each tick.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('bounds the cost of a SINGLE tick even after a massive prior history', () => {
    // This is the sharpest reproduction of the reported bug: the O(n) rescan
    // blocked the event loop PER TICK, not just in cumulative average — a run
    // of many ticks can look fine on average while one tick is catastrophic.
    const cap = 100_000;
    const mirror = new LogMirror(cap);
    const filter = searchFilter('needle');
    mirror.append(makeRows(0, cap, 7), noFilter());
    mirror.rebuild(filter);
    // Preheat: churn through several buffer's worth of history at steady state.
    for (let base = cap; base < cap + 300_000; base += 5_000) {
      mirror.append(makeRows(base, 5_000, 7), filter);
    }

    const t0 = performance.now();
    mirror.append(makeRows(999_999_000, 100, 7), filter); // one steady-state tick
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(16); // one 60Hz frame budget — generous but categorical
  });

  it('bounds memory growth of the filtered index under long-running, high-match-rate churn', () => {
    // Not a perf fix on its own (trimStale is already amortized O(1) regardless)
    // — this guards the COMPACT_THRESHOLD housekeeping that keeps the dead
    // prefix from growing forever in a long session.
    const cap = 50;
    const mirror = new LogMirror(cap);
    const filter = searchFilter('needle'); // matches every row below
    mirror.rebuild(filter);
    const totalPushed = 50_000;
    for (let base = 0; base < totalPushed; base += 500) {
      mirror.append(makeRows(base, 500, 1), filter);
    }
    // Without compaction this would grow linearly to ~50_000. It should stay
    // bounded to a small multiple of COMPACT_THRESHOLD regardless of how much
    // total history has streamed through.
    expect(mirror._debugFilteredRawLength()).toBeLessThan(10_000);
    expect(mirror.displayCount()).toBe(cap); // every row matches, so display == cap
  });
});
