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
export function capMap(map: Map<unknown, unknown>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

/** Far more files than anyone keeps open, so a normal session never evicts. */
export const OPEN_FILE_CACHE_LIMIT = 64;
