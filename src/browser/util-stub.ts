// Browser stub for the Node `util` module — only `promisify` is needed
// (IndexStore wraps `zlib.gzip`/`gunzip`, both already async-callback in
// our `zlib-stub`).
export function promisify<A extends unknown[], R>(
  fn: (...args: [...A, (err: Error | null, result: R) => void]) => void,
): (...args: A) => Promise<R> {
  return (...args: A) =>
    new Promise<R>((resolve, reject) => {
      fn(...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
}
