// Pure log-mirror state for the Logcat webview — zero DOM, zero acquireVsCodeApi.
// Extracted so it is testable directly under vitest (node environment) and so the
// eviction/filtering logic can be exercised without a browser.
//
// Backed by the same LogcatRingBuffer used on the extension-host side (O(1) push,
// no Array.shift()). Filtering is incremental: append() only scans the rows in the
// batch it receives, never the whole buffer — a full rescan only happens on an
// actual filter change (rebuild), a capacity change (resizeCapacity), or a
// visibility resync (hydrate).
import { LogcatRingBuffer } from '../../src/logcat/LogcatRingBuffer';
import type { LogEntry, LogLevel } from '../../src/logcat/messages';

export const ALL_LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'F'];

/** Precomputed once by the caller on filter change, not recomputed per row. */
export interface MirrorFilterState {
  levels: ReadonlySet<LogLevel>;
  hasTag: boolean;
  tagLow: string;
  hasSearch: boolean;
  searchLow: string;
}

export function isFilterActive(f: MirrorFilterState): boolean {
  return f.levels.size !== ALL_LEVELS.length || f.hasTag || f.hasSearch;
}

function matches(e: LogEntry, f: MirrorFilterState): boolean {
  if (!f.levels.has(e.level)) return false;
  if (f.hasTag && !e.tag.toLowerCase().includes(f.tagLow)) return false;
  if (f.hasSearch && !e.message.toLowerCase().includes(f.searchLow)) return false;
  return true;
}

// Threshold at which the dead prefix of filteredSeqs gets compacted away. This is
// a memory bound only, not a perf fix — trimStale() below is already amortized
// O(1) regardless of when (or whether) compaction runs.
const COMPACT_THRESHOLD = 4_096;

export class LogMirror {
  private ring: LogcatRingBuffer;
  private filterActive = false;
  // Filtered rows are addressed by their push ordinal, not by `seq`. The host
  // assigns seq to every row it ingests but only forwards the rows that pass
  // its transport filter (follow-PID, pause), so the mirror ring has holes and
  // `ring.getBySeq()` arithmetic would land on the wrong row. Ordinal minus
  // the number of evicted rows is the current display position, O(1).
  private filteredOrdinals: number[] = [];
  private filteredHead = 0;
  private pushed = 0;

  constructor(capacity: number) {
    this.ring = new LogcatRingBuffer(capacity);
  }

  size(): number { return this.ring.size(); }
  capacityOf(): number { return this.ring.cap(); }

  /**
   * Hot path — called on every batch from the host (~60Hz while streaming).
   * Returns how many displayed rows the ring evicted from the top, so the
   * scroller can keep a reader's viewport on the same rows.
   */
  append(rows: LogEntry[], filter: MirrorFilterState): number {
    const evictedBefore = this.evicted();
    for (const r of rows) {
      this.ring.push(r);
      const ordinal = this.pushed++;
      if (this.filterActive && matches(r, filter)) this.filteredOrdinals.push(ordinal);
    }
    if (this.filterActive) return this.trimStale();
    return this.evicted() - evictedBefore;
  }

  /** Ordinal of the oldest row still retained by the ring. */
  private evicted(): number {
    return this.pushed - this.ring.size();
  }

  /** Drops evicted ordinals from the filtered view; returns how many went. */
  private trimStale(): number {
    const oldestOrdinal = this.evicted();
    const headBefore = this.filteredHead;
    // Amortized O(1): filteredHead only moves forward, so each array index is
    // visited by this loop exactly once, ever.
    while (
      this.filteredHead < this.filteredOrdinals.length &&
      this.filteredOrdinals[this.filteredHead]! < oldestOrdinal
    ) {
      this.filteredHead++;
    }
    const gone = this.filteredHead - headBefore;
    if (this.filteredHead > COMPACT_THRESHOLD && this.filteredHead * 2 > this.filteredOrdinals.length) {
      this.filteredOrdinals = this.filteredOrdinals.slice(this.filteredHead);
      this.filteredHead = 0;
    }
    return gone;
  }

  /** Full O(size) rescan — call only on: level toggle, tag/search edit, resize, hydrate. */
  rebuild(filter: MirrorFilterState): void {
    this.filterActive = isFilterActive(filter);
    if (!this.filterActive) {
      this.filteredOrdinals = [];
      this.filteredHead = 0;
      return;
    }
    const ordinals: number[] = [];
    const base = this.evicted();
    let i = 0;
    for (const e of this.ring.range(0, this.ring.size())) {
      if (matches(e, filter)) ordinals.push(base + i);
      i++;
    }
    this.filteredOrdinals = ordinals;
    this.filteredHead = 0;
  }

  displayCount(): number {
    return this.filterActive ? (this.filteredOrdinals.length - this.filteredHead) : this.ring.size();
  }

  entryAt(displayIdx: number): LogEntry | undefined {
    if (!this.filterActive) return this.ring.at(displayIdx);
    const ordinal = this.filteredOrdinals[this.filteredHead + displayIdx];
    return ordinal === undefined ? undefined : this.ring.at(ordinal - this.evicted());
  }

  reset(): void {
    this.ring.clear();
    this.filteredOrdinals = [];
    this.filteredHead = 0;
    this.filterActive = false;
    this.pushed = 0;
  }

  /** Bulk replace — used for the visibility resync ("hydrate") message. */
  hydrate(rows: LogEntry[], filter: MirrorFilterState): void {
    this.ring.clear();
    this.pushed = 0;
    for (const r of rows) { this.ring.push(r); this.pushed++; }
    this.rebuild(filter);
  }

  /**
   * Capacity change mid-stream. A shrink can evict a burst of old entries at
   * once — never try to patch filteredSeqs incrementally here, always force a
   * full rescan (resize is a rare, discrete event, not a hot path).
   */
  resizeCapacity(n: number, filter: MirrorFilterState): void {
    this.ring.resize(n);
    this.rebuild(filter);
  }

  /** @internal test-only — asserts the amortized-compaction memory bound. */
  _debugFilteredRawLength(): number { return this.filteredOrdinals.length; }
}
