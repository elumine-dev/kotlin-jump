import { describe, it, expect } from 'vitest';
import { LogcatRingBuffer } from '../../src/logcat/LogcatRingBuffer';
import type { LogEntry } from '../../src/logcat/messages';

const mk = (seq: number): LogEntry => ({
  seq, ts: 0, tsDisplay: '00:00:00.000', pid: 0, tid: 0, level: 'I', tag: 't', message: `m${seq}`,
});

describe('LogcatRingBuffer', () => {
  it('rejects non-positive capacity', () => {
    expect(() => new LogcatRingBuffer(0)).toThrow();
    expect(() => new LogcatRingBuffer(-5)).toThrow();
  });

  it('assigns monotonic seqs via allocSeq', () => {
    const buf = new LogcatRingBuffer(10);
    expect(buf.allocSeq()).toBe(0);
    expect(buf.allocSeq()).toBe(1);
    expect(buf.allocSeq()).toBe(2);
  });

  it('evicts oldest when capacity is reached', () => {
    const buf = new LogcatRingBuffer(3);
    for (let i = 0; i < 5; i++) buf.push(mk(i));
    expect(buf.size()).toBe(3);
    expect(buf.dropped()).toBe(2);
    expect(buf.all().map(e => e.seq)).toEqual([2, 3, 4]);
  });

  it('range yields the requested slice', () => {
    const buf = new LogcatRingBuffer(10);
    for (let i = 0; i < 5; i++) buf.push(mk(i));
    expect([...buf.range(1, 4)].map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('clear empties the buffer but keeps seq counter', () => {
    const buf = new LogcatRingBuffer(10);
    buf.push(mk(buf.allocSeq()));
    buf.push(mk(buf.allocSeq()));
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.allocSeq()).toBe(2); // continues from where it left off
  });

  it('resize shrinks evicting oldest', () => {
    const buf = new LogcatRingBuffer(10);
    for (let i = 0; i < 8; i++) buf.push(mk(i));
    buf.resize(4);
    expect(buf.size()).toBe(4);
    expect(buf.cap()).toBe(4);
    expect(buf.all().map(e => e.seq)).toEqual([4, 5, 6, 7]);
  });

  describe('at()', () => {
    it('returns undefined out of range on an empty buffer', () => {
      const buf = new LogcatRingBuffer(5);
      expect(buf.at(0)).toBeUndefined();
      expect(buf.at(-1)).toBeUndefined();
    });

    it('returns entries by display position, 0 = oldest retained', () => {
      const buf = new LogcatRingBuffer(3);
      for (let i = 0; i < 3; i++) buf.push(mk(i));
      expect(buf.at(0)!.seq).toBe(0);
      expect(buf.at(2)!.seq).toBe(2);
      expect(buf.at(3)).toBeUndefined();
      expect(buf.at(-1)).toBeUndefined();
    });

    it('stays correct after eviction has wrapped the ring', () => {
      const buf = new LogcatRingBuffer(3);
      for (let i = 0; i < 5; i++) buf.push(mk(i));
      expect(buf.at(0)!.seq).toBe(2); // oldest retained after 2 evictions
      expect(buf.at(2)!.seq).toBe(4);
      expect(buf.at(3)).toBeUndefined();
    });

    it('stays correct after resize()', () => {
      const buf = new LogcatRingBuffer(10);
      for (let i = 0; i < 8; i++) buf.push(mk(i));
      buf.resize(4);
      expect(buf.at(0)!.seq).toBe(4);
      expect(buf.at(3)!.seq).toBe(7);
      expect(buf.at(4)).toBeUndefined();
    });

    it('stays correct after clear()', () => {
      const buf = new LogcatRingBuffer(5);
      buf.push(mk(buf.allocSeq())); // seq 0
      buf.clear();
      expect(buf.at(0)).toBeUndefined();
      buf.push(mk(buf.allocSeq())); // seq 1 — allocSeq is preserved across clear()
      expect(buf.at(0)!.seq).toBe(1);
    });
  });

  describe('getBySeq()', () => {
    it('returns undefined on an empty buffer', () => {
      const buf = new LogcatRingBuffer(5);
      expect(buf.getBySeq(0)).toBeUndefined();
    });

    it('finds an entry that is still retained', () => {
      const buf = new LogcatRingBuffer(5);
      for (let i = 0; i < 5; i++) buf.push(mk(i));
      expect(buf.getBySeq(2)!.seq).toBe(2);
      expect(buf.getBySeq(4)!.seq).toBe(4);
    });

    it('returns undefined for a seq already evicted', () => {
      const buf = new LogcatRingBuffer(3);
      for (let i = 0; i < 5; i++) buf.push(mk(i)); // evicts seq 0 and 1
      expect(buf.getBySeq(0)).toBeUndefined();
      expect(buf.getBySeq(1)).toBeUndefined();
      expect(buf.getBySeq(2)!.seq).toBe(2);
    });

    it('returns undefined for a seq not yet pushed', () => {
      const buf = new LogcatRingBuffer(5);
      buf.push(mk(0));
      expect(buf.getBySeq(99)).toBeUndefined();
    });

    it('stays correct across a clear() + new pushes (seqs never reused)', () => {
      const buf = new LogcatRingBuffer(5);
      buf.push(mk(buf.allocSeq())); // seq 0
      buf.push(mk(buf.allocSeq())); // seq 1
      buf.clear();
      const seq = buf.allocSeq(); // seq 2 — never reused after clear
      buf.push(mk(seq));
      expect(buf.getBySeq(0)).toBeUndefined();
      expect(buf.getBySeq(2)!.seq).toBe(2);
    });
  });
});
