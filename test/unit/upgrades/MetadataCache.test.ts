import { describe, it, expect } from 'vitest';
import { MemoryCacheStore, MetadataCache, freshness, ttlFor } from '../../../src/upgrades/cache';
import type { CacheEntry, CacheStore } from '../../../src/upgrades/cache';

/**
 * KJ-082, what the version check remembers between two openings of a catalog.
 *
 * A repository answers the same for every project, so entries are keyed by
 * repository and coordinates and kept a day (the master index a week, the
 * Gradle release half a day). A stale entry is still served, marked stale, so
 * the catalog paints at once and the revalidation happens behind it with a
 * conditional request. `get` never reads the disk: `warm` loads what a file
 * needs before the first paint, which is how the paint stays under 5 ms.
 */

const H = 3_600_000;
const D = 24 * H;
const entry = (over: Partial<CacheEntry> = {}): CacheEntry => ({ v: 1, url: 'https://repo1.maven.org/x', fetchedAt: 0, status: 'ok', versions: ['1.0.0'], ...over });

describe('ttlFor and freshness', () => {
  it('keeps a document a day, the master index a week, the Gradle release half a day, a 404 a day', () => {
    expect(ttlFor('central/com/squareup/okhttp3/okhttp')).toBe(D);
    expect(ttlFor('google/androidx/compose/ui/_group')).toBe(D);
    expect(ttlFor('google/_master')).toBe(7 * D);
    expect(ttlFor('gradle/_versions')).toBe(12 * H);
    expect(ttlFor('gradle/_rc')).toBe(12 * H);
    expect(ttlFor('google/_master', entry({ status: 'notFound' }))).toBe(D);
  });

  it('is fresh strictly inside the ttl and stale from the ttl on', () => {
    const e = entry({ fetchedAt: 1000 });
    expect(freshness(e, 1000 + D - 1, D)).toBe('fresh');
    expect(freshness(e, 1000 + D, D)).toBe('stale');
    expect(freshness(e, 500, D)).toBe('fresh');
  });
});

describe('MetadataCache', () => {
  it('serves a fresh entry as fresh and a stale one as stale, by the fake clock', async () => {
    let now = 0;
    const cache = new MetadataCache(new MemoryCacheStore(), () => now);
    await cache.put('central/a/b', entry({ fetchedAt: 0 }));
    expect(cache.get('central/a/b')).toEqual({ entry: entry({ fetchedAt: 0 }), fresh: true });
    now = D + 1;
    expect(cache.get('central/a/b')?.fresh).toBe(false);
    expect(cache.get('central/a/b')?.entry.versions).toEqual(['1.0.0']);
    expect(cache.get('central/missing')).toBeUndefined();
  });

  it('warms from the store in parallel and then answers without touching it', async () => {
    const reads: string[] = [];
    const store: CacheStore = {
      async read(key) { reads.push(key); return key === 'central/a/b' ? entry({ versions: ['2.0.0'] }) : undefined; },
      async write() { /* unused */ },
    };
    const cache = new MetadataCache(store, () => 0);
    await cache.warm(['central/a/b', 'central/c/d']);
    expect(reads.sort()).toEqual(['central/a/b', 'central/c/d']);
    reads.length = 0;
    expect(cache.get('central/a/b')?.entry.versions).toEqual(['2.0.0']);
    expect(cache.get('central/c/d')).toBeUndefined();
    await cache.warm(['central/a/b']);
    expect(reads).toEqual([]);
  });

  it('writes through to the store on put and on touch, and touch only moves fetchedAt', async () => {
    const store = new MemoryCacheStore();
    const cache = new MetadataCache(store, () => 10);
    await cache.put('gradle/_versions', entry({ fetchedAt: 10, etag: '"abc"', gradle: { current: '9.8.2' } }));
    expect((await store.read('gradle/_versions'))?.gradle).toEqual({ current: '9.8.2' });
    await cache.touch('gradle/_versions', 500);
    expect(cache.get('gradle/_versions')?.entry.fetchedAt).toBe(500);
    expect((await store.read('gradle/_versions'))?.fetchedAt).toBe(500);
    expect((await store.read('gradle/_versions'))?.etag).toBe('"abc"');
  });

  it('builds the conditional headers from the etag and the last modified date', () => {
    const cache = new MetadataCache(new MemoryCacheStore());
    expect(cache.conditionalHeaders(entry({ etag: '"abc"' }))).toEqual({ 'If-None-Match': '"abc"' });
    expect(cache.conditionalHeaders(entry({ lastModified: 'Wed, 22 Oct 2026 12:46:00 GMT' }))).toEqual({ 'If-Modified-Since': 'Wed, 22 Oct 2026 12:46:00 GMT' });
    expect(cache.conditionalHeaders(entry({ etag: '"abc"', lastModified: 'Wed, 22 Oct 2026 12:46:00 GMT' }))).toEqual({ 'If-None-Match': '"abc"', 'If-Modified-Since': 'Wed, 22 Oct 2026 12:46:00 GMT' });
    expect(cache.conditionalHeaders(entry())).toEqual({});
  });

  it('keeps a negative entry a day and no longer', async () => {
    let now = 0;
    const cache = new MetadataCache(new MemoryCacheStore(), () => now);
    await cache.put('central/gone/lib', entry({ status: 'notFound', versions: undefined }));
    expect(cache.get('central/gone/lib')).toEqual({ entry: entry({ status: 'notFound', versions: undefined }), fresh: true });
    now = D;
    expect(cache.get('central/gone/lib')?.fresh).toBe(false);
  });

  it('caps the memory layer at 2048 entries and evicts the oldest first', async () => {
    const cache = new MetadataCache(new MemoryCacheStore(), () => 0);
    for (let i = 0; i < 2050; i++) await cache.put(`central/g/a${i}`, entry());
    expect(cache.size).toBe(2048);
    expect(cache.get('central/g/a0')).toBeUndefined();
    expect(cache.get('central/g/a1')).toBeUndefined();
    expect(cache.get('central/g/a2')).toBeDefined();
    expect(cache.get('central/g/a2049')).toBeDefined();
  });

  it('removes an entry from memory and from the store', async () => {
    const store = new MemoryCacheStore();
    const cache = new MetadataCache(store, () => 0);
    await cache.put('central/a/b', entry());
    await cache.remove('central/a/b');
    expect(cache.get('central/a/b')).toBeUndefined();
    expect(await store.read('central/a/b')).toBeUndefined();
  });
});
