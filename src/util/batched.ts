/**
 * Maps `fn` over `items` with bounded concurrency, batch by batch.
 *
 * An unbatched `Promise.all(items.map(readFile))` over a workspace-sized
 * list fires every read simultaneously — an I/O storm that competes with
 * VS Code's startup and with git operations sharing the disk. Sixteen at
 * a time does the same total work without the spike.
 */
export async function mapBatched<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
  batchSize = 16,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(fn));
  }
}
