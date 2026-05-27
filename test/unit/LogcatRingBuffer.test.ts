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
});
