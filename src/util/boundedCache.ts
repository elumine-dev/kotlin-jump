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
