// Byte/string conversions that work in BOTH extension hosts:
//   - desktop (Node.js): Buffer fast path, zero-copy view over the input
//   - web (Web Worker on vscode.dev): TextDecoder / btoa — no Node globals
//
// `Buffer` does not exist in the web extension host, so any shared module
// (FindUsagesEngine, IndexStore, drawable previews…) must route through
// these helpers instead of calling Buffer directly.

const HAS_BUFFER = typeof Buffer !== 'undefined';
// ignoreBOM keeps parity with Buffer.toString('utf8'): the default decoder
// strips a leading U+FEFF, which would shift every offset in a BOM'd file
// by one on web vs desktop (Find Usages columns, parser positions).
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

// btoa takes a "binary string" (one char per byte). Build it in chunks:
// String.fromCharCode(...bytes) overflows the argument stack past ~125k
// elements, and per-byte concatenation is quadratic on large images.
const BTOA_CHUNK = 0x8000;

/** Browser implementations. Exported for unit tests only — vitest runs on
 *  Node where Buffer always exists, so the production picker below would
 *  never exercise these. */
export const _webImpl = {
  decodeUtf8: (bytes: Uint8Array): string => UTF8_DECODER.decode(bytes),
  bytesToBase64: (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += BTOA_CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + BTOA_CHUNK));
    }
    return btoa(binary);
  },
};

/** UTF-8 decode without copying the input (hot path: file-content reads). */
export const decodeUtf8: (bytes: Uint8Array) => string = HAS_BUFFER
  ? bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
  : _webImpl.decodeUtf8;

/** Base64-encode raw bytes (drawable thumbnails, hover previews). */
export const bytesToBase64: (bytes: Uint8Array) => string = HAS_BUFFER
  ? bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  : _webImpl.bytesToBase64;

/** Base64-encode a JS string as UTF-8 (SVG markup in data: URIs). */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}
