/**
 * A ceiling for the per file caches of the providers.
 *
 * They are all keyed by document URI and answer for the editor the user is
 * looking at, but nothing ever removed an entry: browsing a project filled
 * them and they never emptied. Measured over a real Android project of 5088
 * files, the folding cache held 5088 entries and 44 058 ranges, the semantic
 * token cache 5088 entries and 3.4 MB of token data, none of it on screen.
 *
 * The oldest entry goes first rather than the whole map, so the files still
 * open keep their answer and nothing repaints.
 */
export function capMap<K, V>(
  map: Map<K, V>,
  limit: number,
  /** Entries this returns false for are kept whatever their age. Used by the
   *  usage cache, whose entries can hold a scan still running. */
  canEvict?: (value: V) => boolean,
): void {
  if (map.size <= limit) return;
  for (const [key, value] of map) {
    if (map.size <= limit) return;
    if (canEvict && !canEvict(value)) continue;
    map.delete(key);
  }
}

/** Far more files than anyone keeps open, so a normal session never evicts. */
export const OPEN_FILE_CACHE_LIMIT = 64;

/**
 * Ceiling for the usage cache, keyed by symbol rather than by file. One file
 * of the reference project produces 202 lenses on its own, and the whole
 * project would produce 23 628, so this is sized for a few files on screen at
 * once rather than for a few files at all.
 */
export const USAGE_CACHE_LIMIT = 512;

/**
 * Cheap content fingerprint for a cache key.
 *
 * Version alone is not identity: closing a document destroys it, and reopening
 * the file builds a new one whose version restarts at 1. Length is not either:
 * two texts of exactly 64 characters gave the second one the first one's fold
 * ranges. Measured on a real project of 3187 Kotlin files, this costs 4.7 us
 * on the average file and 0.095 ms on the largest, against 1.7 ms to recompute
 * the folds of one file, so it is a few percent of what the cache saves.
 */
export function fingerprint(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Does this cache entry still describe `text`, and can we say so cheaply?
 *
 * The same document object at the same version is necessarily the same text,
 * since the version is bumped on every change, so comparing the reference
 * settles it for free. When the object differs, which is the reopened file the
 * fingerprint exists for, the text is hashed once and the reference is
 * REFRESHED: without that refresh a caller that hands over a new object each
 * time paid the hash forever, measured at 39 times the cost.
 */
export function sameDocument<D extends object>(
  entry: { doc: D; fp: number },
  doc: D,
  text: () => string,
): boolean {
  if (entry.doc === doc) return true;
  if (entry.fp !== fingerprint(text())) return false;
  entry.doc = doc;
  return true;
}
