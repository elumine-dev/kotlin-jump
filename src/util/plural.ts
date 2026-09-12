/**
 * A count and its noun, agreeing.
 *
 * Four counts on one line of the screen flow legend, the dead island message
 * and its quick fix title all wrote the plural in place, so a single item read
 * `1 screens`, `1 declarations`, `1 file(s)`. Several other places in the same
 * codebase already agreed their own counts by hand, which is how the misses
 * stayed invisible: the shape was known, it just was not shared.
 *
 * English pluralises zero, so only one is singular.
 */
export function plural(n: number, word: string, pluriel?: string): string {
  return `${n} ${n === 1 ? word : pluriel ?? `${word}s`}`;
}
