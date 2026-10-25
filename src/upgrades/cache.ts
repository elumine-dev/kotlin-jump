/**
 * What a version check remembers between two openings of a catalog.
 *
 * A repository answers the same for every project, so entries are keyed by
 * repository and coordinates (`central/com/squareup/okhttp3/okhttp`) and the
 * store is global to the machine. A document is kept a day, the Google master
 * index a week (groups appear rarely), the current Gradle release half a day,
 * and a 404 a day too, so a missing artifact is not asked again at every
 * keystroke.
 *
 * A stale entry is still an answer: it is served as stale so the catalog
 * paints at once, and the caller revalidates behind the paint with the
 * conditional headers. `get` never reads the store: `warm` loads what a file
 * needs before its first paint, which is how the paint stays under 5 ms.
 *
 * No vscode, no Node: the disk store lives elsewhere and implements `CacheStore`.
 */
import type { CacheEntry } from './model';
import { capMap } from '../util/boundedCache';

export type { CacheEntry } from './model';

export interface CacheStore {
  read(key: string): Promise<CacheEntry | undefined>;
  write(key: string, entry: CacheEntry): Promise<void>;
  remove?(key: string): Promise<void>;
}

/** A store for tests and for the web build, where nothing survives the session. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();
  async read(key: string): Promise<CacheEntry | undefined> { return this.entries.get(key); }
  async write(key: string, entry: CacheEntry): Promise<void> { this.entries.set(key, entry); }
  async remove(key: string): Promise<void> { this.entries.delete(key); }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Entries kept in memory; a very large workspace needs a few hundred. */
export const MEMORY_LIMIT = 2048;

/** How long an entry answers as fresh. */
export function ttlFor(key: string, entry?: CacheEntry): number {
  if (entry?.status === 'notFound') return DAY;
  if (key === 'google/_master') return 7 * DAY;
  if (key === 'gradle/_versions' || key === 'gradle/_rc') return 12 * HOUR;
  return DAY;
}

export function freshness(entry: CacheEntry, now: number, ttl: number): 'fresh' | 'stale' {
  return now - entry.fetchedAt < ttl ? 'fresh' : 'stale';
}

export interface CachedAnswer { entry: CacheEntry; fresh: boolean }

export class MetadataCache {
  private readonly memory = new Map<string, CacheEntry>();

  constructor(private readonly store: CacheStore, private readonly now: () => number = Date.now) {}

  get size(): number { return this.memory.size; }

  /** Memory only: never a disk read on the render path. */
  get(key: string): CachedAnswer | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    return { entry, fresh: freshness(entry, this.now(), ttlFor(key, entry)) === 'fresh' };
  }

  /** Loads the entries a file needs into memory, in parallel, before its first paint. */
  async warm(keys: readonly string[]): Promise<void> {
    const missing = [...new Set(keys)].filter(k => !this.memory.has(k));
    const read = await Promise.all(missing.map(async k => [k, await this.safeRead(k)] as const));
    for (const [k, entry] of read) if (entry) this.remember(k, entry);
  }

  async put(key: string, entry: CacheEntry): Promise<void> {
    this.remember(key, entry);
    await this.store.write(key, entry);
  }

  /** A 304 answer: the document has not changed, only the moment it was checked moves. */
  async touch(key: string, now: number): Promise<void> {
    const entry = this.memory.get(key);
    if (!entry) return;
    const touched = { ...entry, fetchedAt: now };
    this.remember(key, touched);
    await this.store.write(key, touched);
  }

  async remove(key: string): Promise<void> {
    this.memory.delete(key);
    await this.store.remove?.(key);
  }

  conditionalHeaders(entry: CacheEntry): Record<string, string> {
    const headers: Record<string, string> = {};
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
    return headers;
  }

  private remember(key: string, entry: CacheEntry): void {
    // Delete first so a refreshed key becomes the youngest and is evicted last.
    this.memory.delete(key);
    this.memory.set(key, entry);
    capMap(this.memory, MEMORY_LIMIT);
  }

  private async safeRead(key: string): Promise<CacheEntry | undefined> {
    try {
      const entry = await this.store.read(key);
      return entry && entry.v === 1 ? entry : undefined;
    } catch {
      return undefined;
    }
  }
}
