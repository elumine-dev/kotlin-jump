import { describe, it, expect } from 'vitest';
import { FetchQueue } from '../../../src/upgrades/fetchQueue';
import type { MetadataFetcher } from '../../../src/upgrades/fetchQueue';

/**
 * KJ-082, how the version check talks to a repository without being banned.
 *
 * Maven Central blocks a client that hammers it, for up to a day. The queue
 * keeps six requests in flight, four per host, fifty milliseconds apart on
 * one host, retries a server error once, never retries a 404 or a 429, and
 * after a 429 or a 403 it stops talking to that host for the time the
 * repository asks, fifteen minutes by default. A lost DNS answer means the
 * machine is offline: nothing is sent for ten minutes. A 200 whose body is an
 * HTML sign in page is not metadata and is reported as such, so the caller
 * never caches it.
 */

interface Call { url: string; headers: Record<string, string>; signal?: AbortSignal; at: number }

/** Ten turns of the microtask queue: enough for the queue's awaits to settle between two steps of virtual time. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * A virtual clock: `sleep` parks a timer, `settle` runs the microtasks, then
 * advances the clock to the earliest timer, until the promise is done. Starts
 * recorded by the fetcher therefore read the time the queue let them go.
 */
function harness(opts: { respond?: (call: Call, index: number) => Promise<{ status: number; headers?: Record<string, string>; body?: string }> } = {}) {
  let clock = 0;
  const timers: { at: number; resolve: () => void }[] = [];
  const calls: Call[] = [];
  const fetcher: MetadataFetcher = async req => {
    const call = { url: req.url, headers: req.headers, signal: req.signal, at: clock };
    calls.push(call);
    const r = await (opts.respond ?? (async () => ({ status: 200 })))(call, calls.length - 1);
    return { status: r.status, headers: r.headers ?? {}, body: r.body ?? '<metadata><versioning><versions><version>1.0.0</version></versions></versioning></metadata>' };
  };
  const queue = new FetchQueue(fetcher, {
    now: () => clock,
    sleep: ms => new Promise<void>(resolve => { timers.push({ at: clock + ms, resolve }); }),
  });
  const tick = (): boolean => {
    if (timers.length === 0) return false;
    const at = Math.min(...timers.map(t => t.at));
    clock = Math.max(clock, at);
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) t.resolve(); else timers.push(t);
    }
    return true;
  };
  const settle = async <T>(p: Promise<T>): Promise<T> => {
    let done = false;
    void p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 1000 && !done; i++) {
      await flush();
      if (done) break;
      if (!tick()) { await flush(); if (!done) break; }
    }
    return p;
  };
  return { queue, calls, clock: () => clock, advance: (ms: number) => { clock += ms; }, settle, tick };
}

/** A fetch whose completion the test controls. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('FetchQueue', () => {
  it('returns the body and the headers of a 200 whose body is metadata', async () => {
    const h = harness({ respond: async () => ({ status: 200, headers: { etag: '"a"' } }) });
    const r = await h.queue.fetch('https://repo1.maven.org/maven2/a/b/maven-metadata.xml');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') { expect(r.headers.etag).toBe('"a"'); expect(r.body).toContain('<metadata>'); }
    expect(h.queue.stats()).toEqual({ sent: 1, notModified: 0, fromDedupe: 0 });
  });

  it('never has more than six requests in flight, nor more than four on one host', async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    let inFlight = 0, maxInFlight = 0;
    const perHost = new Map<string, number>(); let maxPerHost = 0;
    const h = harness({ respond: async call => {
      const host = new URL(call.url).hostname;
      inFlight++; perHost.set(host, (perHost.get(host) ?? 0) + 1);
      maxInFlight = Math.max(maxInFlight, inFlight); maxPerHost = Math.max(maxPerHost, perHost.get(host)!);
      const g = deferred(); gates.push(g); await g.promise;
      inFlight--; perHost.set(host, perHost.get(host)! - 1);
      return { status: 200 };
    } });
    const urls = [...Array(8)].map((_, i) => `https://repo1.maven.org/maven2/a/b${i}/maven-metadata.xml`)
      .concat([...Array(8)].map((_, i) => `https://dl.google.com/dl/android/maven2/g${i}/group-index.xml`));
    const all = Promise.all(urls.map(u => h.queue.fetch(u)));
    let opened = 0;
    for (let i = 0; i < 200 && opened < urls.length; i++) {
      await flush();
      for (const g of gates.splice(0)) { opened++; g.resolve(); }
      await flush();
      h.tick();
    }
    const results = await h.settle(all);
    expect(results.every(r => r.kind === 'ok')).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxPerHost).toBeLessThanOrEqual(4);
    expect(h.calls).toHaveLength(16);
  });

  it('spaces two starts on the same host by fifty milliseconds of the clock', async () => {
    const h = harness();
    await h.settle(Promise.all([
      h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml'),
      h.queue.fetch('https://repo1.maven.org/maven2/b/maven-metadata.xml'),
      h.queue.fetch('https://repo1.maven.org/maven2/c/maven-metadata.xml'),
    ]));
    const starts = h.calls.map(c => c.at).sort((a, b) => a - b);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(50);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(50);
  });

  it('turns a 304 into notModified, a 404 into notFound without a retry, and an HTML body into badBody', async () => {
    const h = harness({ respond: async call => {
      if (call.url.endsWith('/gone')) return { status: 404 };
      if (call.url.endsWith('/same')) return { status: 304 };
      return { status: 200, body: '<!DOCTYPE html><html><body>Sign in</body></html>' };
    } });
    expect(await h.settle(h.queue.fetch('https://repo1.maven.org/gone'))).toEqual({ kind: 'notFound' });
    expect(await h.settle(h.queue.fetch('https://repo1.maven.org/same'))).toEqual({ kind: 'notModified' });
    expect(await h.settle(h.queue.fetch('https://repo1.maven.org/portal'))).toEqual({ kind: 'badBody' });
    expect(h.calls).toHaveLength(3);
    expect(h.queue.stats().notModified).toBe(1);
  });

  it('on a 429, quiets the host for the Retry-After, resolves what is pending as rateLimited and sends nothing more', async () => {
    const h = harness({ respond: async call => (call.url.includes('/limited') ? { status: 429, headers: { 'retry-after': '120' } } : { status: 200 }) });
    const first = await h.queue.fetch('https://repo1.maven.org/limited');
    expect(first).toEqual({ kind: 'rateLimited' });
    expect(h.queue.quietHosts()).toEqual(['repo1.maven.org']);
    const later = await Promise.all([
      h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml'),
      h.queue.fetch('https://dl.google.com/dl/android/maven2/master-index.xml'),
    ]);
    expect(later[0]).toEqual({ kind: 'rateLimited' });
    expect(later[1].kind).toBe('ok');
    expect(h.calls.map(c => new URL(c.url).hostname)).toEqual(['repo1.maven.org', 'dl.google.com']);
    h.advance(121_000);
    expect(h.queue.quietHosts()).toEqual([]);
    expect((await h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml')).kind).toBe('ok');
  });

  it('quiets a host fifteen minutes on a 403 without Retry-After, and reads an HTTP date Retry-After', async () => {
    const h = harness({ respond: async call => (call.url.includes('/forbidden') ? { status: 403 } : { status: 429, headers: { 'retry-after': new Date(30_000).toUTCString() } }) });
    expect(await h.queue.fetch('https://repo1.maven.org/forbidden')).toEqual({ kind: 'rateLimited' });
    h.advance(15 * 60_000 - 1);
    expect(h.queue.quietHosts()).toEqual(['repo1.maven.org']);
    h.advance(2);
    expect(h.queue.quietHosts()).toEqual([]);
    const t0 = h.clock();
    expect(await h.queue.fetch('https://plugins.gradle.org/m2/x/maven-metadata.xml')).toEqual({ kind: 'rateLimited' });
    expect(h.queue.quietHosts()).toEqual(['plugins.gradle.org']);
    // The date is read relative to the real epoch, so a date in the past gives the default quiet, not a negative one.
    expect(h.clock()).toBe(t0);
  });

  it('on a lost DNS answer, reports offline and sends nothing to any host for ten minutes', async () => {
    const h = harness({ respond: async () => { throw new Error('getaddrinfo ENOTFOUND repo1.maven.org'); } });
    expect(await h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml')).toEqual({ kind: 'offline' });
    expect(await h.queue.fetch('https://dl.google.com/dl/android/maven2/master-index.xml')).toEqual({ kind: 'offline' });
    expect(h.calls).toHaveLength(1);
    h.advance(10 * 60_000 + 1);
    await h.queue.fetch('https://dl.google.com/dl/android/maven2/master-index.xml');
    expect(h.calls).toHaveLength(2);
  });

  it('retries a server error and a network error once after a second, then gives up', async () => {
    let n = 0;
    const h = harness({ respond: async () => { n++; return n === 1 ? { status: 503 } : { status: 200 }; } });
    const t0 = h.clock();
    expect((await h.settle(h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml'))).kind).toBe('ok');
    expect(h.calls).toHaveLength(2);
    expect(h.clock() - t0).toBeGreaterThanOrEqual(1000);
    const bad = harness({ respond: async () => ({ status: 502 }) });
    const r = await bad.settle(bad.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml'));
    expect(r).toEqual({ kind: 'error', message: 'HTTP 502' });
    expect(bad.calls).toHaveLength(2);
    const broken = harness({ respond: async () => { throw new Error('socket hang up'); } });
    expect(await broken.settle(broken.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml'))).toEqual({ kind: 'error', message: 'socket hang up' });
    expect(broken.calls).toHaveLength(2);
  });

  it('sends one request for two callers of the same URL while it is in flight', async () => {
    const gate = deferred();
    const h = harness({ respond: async () => { await gate.promise; return { status: 200 }; } });
    const a = h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml');
    const b = h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml');
    await Promise.resolve();
    gate.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.kind).toBe('ok');
    expect(rb.kind).toBe('ok');
    expect(h.calls).toHaveLength(1);
    expect(h.queue.stats().fromDedupe).toBe(1);
  });

  it('passes the conditional headers and the timeout to the fetcher, and reports an aborted request as an error', async () => {
    const h = harness({ respond: async call => {
      if (call.signal?.aborted) throw new Error('aborted');
      return { status: 200 };
    } });
    await h.queue.fetch('https://repo1.maven.org/maven2/a/maven-metadata.xml', { 'If-None-Match': '"x"' });
    expect(h.calls[0].headers['If-None-Match']).toBe('"x"');
    const controller = new AbortController();
    controller.abort();
    const r = await h.queue.fetch('https://repo1.maven.org/maven2/b/maven-metadata.xml', {}, controller.signal);
    expect(r).toEqual({ kind: 'error', message: 'aborted' });
  });
});
