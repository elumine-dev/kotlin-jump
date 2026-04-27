// Browser stub for `zlib`: identity gzip/gunzip. The IndexStore's
// load() detects the missing gzip magic bytes and falls back to raw
// JSON, so the round-trip still works correctly — snapshots are just
// uncompressed in the browser variant of the extension.
type Cb = (err: Error | null, result: Uint8Array) => void;

export function gzip(input: string | Uint8Array, cb: Cb): void {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  cb(null, bytes);
}

export function gunzip(input: Uint8Array, cb: Cb): void {
  cb(null, input);
}
