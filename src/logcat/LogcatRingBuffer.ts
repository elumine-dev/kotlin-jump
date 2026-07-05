import type { LogEntry } from './messages';

/**
 * Bounded ring buffer for log entries with O(1) push and clear at any capacity.
 *
 * The previous implementation used `Array.prototype.shift()` for FIFO eviction,
 * which is O(n) per push under V8 once the buffer fills. At 100 000 entries
 * with sustained 10 000 events per second, the cumulative cost reached the
 * point where pushes blocked the event loop. This implementation uses a
 * fixed-size array with head/tail indices so push is constant time regardless
 * of capacity.
 *
 * Eviction is FIFO when capacity is reached. `seq` is monotonic across the
 * lifetime of the buffer so the UI can identify rows uniquely even after
 * multiple wraps.
 */
export class LogcatRingBuffer {
  private slots: Array<LogEntry | undefined>;
  private capacity_: number;
  private head = 0;        // index of the oldest entry
  private size_ = 0;       // number of valid entries (0..capacity)
  private nextSeq = 0;
  private droppedCount = 0;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('LogcatRingBuffer: capacity must be > 0');
    this.capacity_ = capacity;
    this.slots = new Array<LogEntry | undefined>(capacity);
  }

  push(entry: LogEntry): void {
    const cap = this.capacity_;
    if (this.size_ < cap) {
      const idx = (this.head + this.size_) % cap;
      this.slots[idx] = entry;
      this.size_++;
    } else {
      // Full — overwrite oldest, advance head.
      this.slots[this.head] = entry;
      this.head = (this.head + 1) % cap;
      this.droppedCount++;
    }
  }

  /** Allocates a new monotonic seq id. Use as the `seq` callback in the parser. */
  allocSeq = (): number => this.nextSeq++;

  size(): number { return this.size_; }
  cap(): number { return this.capacity_; }
  dropped(): number { return this.droppedCount; }

  /**
   * O(1) random access by display position (0 = oldest currently retained entry).
   * Returns undefined out of range — callers already bound their loops with
   * size()/displayCount(), so this is a no-throw contract, not an error path.
   */
  at(i: number): LogEntry | undefined {
    if (i < 0 || i >= this.size_) return undefined;
    return this.slots[(this.head + i) % this.capacity_];
  }

  /**
   * O(1) lookup by the entry's stable `seq`. Relies on seq being densely
   * monotonic with no gaps within one buffer's lifetime — guaranteed because
   * `allocSeq()` is the only seq source and every pushed entry consumes exactly
   * one call. If that invariant is ever broken (a future dedup/batch-ingestion
   * path that skips allocSeq for some rows), this silently returns the wrong
   * entry instead of undefined — grep for `allocSeq` before touching ingestion.
   */
  getBySeq(seq: number): LogEntry | undefined {
    const oldest = this.at(0);
    if (!oldest) return undefined;
    return this.at(seq - oldest.seq);
  }

  /** Returns a shallow copy of all buffered entries in FIFO order. */
  all(): LogEntry[] {
    const out: LogEntry[] = new Array(this.size_);
    const cap = this.capacity_;
    for (let i = 0; i < this.size_; i++) {
      out[i] = this.slots[(this.head + i) % cap]!;
    }
    return out;
  }

  /** Iterates entries between two display indices [from, to). */
  *range(from: number, to: number): IterableIterator<LogEntry> {
    const lo = Math.max(0, from);
    const hi = Math.min(this.size_, to);
    const cap = this.capacity_;
    for (let i = lo; i < hi; i++) {
      yield this.slots[(this.head + i) % cap]!;
    }
  }

  clear(): void {
    // O(cap) zeroing — important so we release entry references for GC. Without
    // this, retained slots keep the old LogEntry objects alive after a clear.
    this.slots.fill(undefined);
    this.head = 0;
    this.size_ = 0;
    this.droppedCount = 0;
    // nextSeq intentionally preserved — UI seqs must stay unique across clears.
  }

  /**
   * Resizes capacity. If shrinking below current size, oldest entries are dropped.
   * O(min(oldSize, newCap)) work — copies retained entries into a fresh ring.
   */
  resize(newCap: number): void {
    if (newCap <= 0) throw new Error('LogcatRingBuffer: capacity must be > 0');
    if (newCap === this.capacity_) return;

    const retained = Math.min(this.size_, newCap);
    const dropping = this.size_ - retained;
    const oldCap   = this.capacity_;
    const oldHead  = this.head;
    const oldSlots = this.slots;

    const fresh = new Array<LogEntry | undefined>(newCap);
    // Copy the most recent `retained` entries into the new ring, oldest first.
    const startOld = (oldHead + dropping) % oldCap;
    for (let i = 0; i < retained; i++) {
      fresh[i] = oldSlots[(startOld + i) % oldCap]!;
    }

    this.slots = fresh;
    this.capacity_ = newCap;
    this.head = 0;
    this.size_ = retained;
    this.droppedCount += dropping;
  }
}
