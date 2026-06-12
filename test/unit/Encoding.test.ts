import { describe, expect, it } from 'vitest';
import { decodeUtf8, bytesToBase64, utf8ToBase64, _webImpl } from '../../src/util/encoding';

// Both implementations must agree byte-for-byte: the production picker
// selects the Buffer fast path on desktop and _webImpl on vscode.dev,
// and a divergence would mean the same file decodes differently per host.
const DECODERS: Array<[string, (b: Uint8Array) => string]> = [
  ['node (Buffer fast path)', decodeUtf8],
  ['web (TextDecoder)', _webImpl.decodeUtf8],
];
const ENCODERS: Array<[string, (b: Uint8Array) => string]> = [
  ['node (Buffer fast path)', bytesToBase64],
  ['web (btoa chunked)', _webImpl.bytesToBase64],
];

const utf8 = (s: string) => new TextEncoder().encode(s);

describe.each(DECODERS)('decodeUtf8 — %s', (_name, decode) => {
  it('decodes ASCII', () => {
    expect(decode(utf8('class Foo'))).toBe('class Foo');
  });

  it('decodes 2-byte sequences (accents)', () => {
    expect(decode(utf8('réindexé — déjà vu'))).toBe('réindexé — déjà vu');
  });

  it('decodes 3- and 4-byte sequences (CJK, emoji)', () => {
    expect(decode(utf8('クラス 🚀 函数'))).toBe('クラス 🚀 函数');
  });

  it('decodes the empty array', () => {
    expect(decode(new Uint8Array(0))).toBe('');
  });

  it('respects byteOffset/byteLength views over a larger buffer', () => {
    // The Buffer fast path wraps `bytes.buffer` directly — if it ignored
    // byteOffset or byteLength it would decode neighbouring garbage.
    const backing = utf8('XXXhelloYYY');
    const view = new Uint8Array(backing.buffer, 3, 5);
    expect(decode(view)).toBe('hello');
  });

  it('round-trips a multibyte view sliced on char boundaries', () => {
    const backing = utf8('aaéçüzz');
    // 'éçü' is bytes 2..8 (each char is 2 bytes)
    const view = new Uint8Array(backing.buffer, 2, 6);
    expect(decode(view)).toBe('éçü');
  });

  it('keeps a leading BOM, exactly like Buffer.toString', () => {
    // A stripped BOM would shift every parser/Find-Usages offset by one
    // on web vs desktop. Buffer keeps U+FEFF; the decoder must too.
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]);
    expect(decode(bytes)).toBe('﻿ab');
  });

  it('replaces invalid UTF-8 like Buffer does', () => {
    const bad = new Uint8Array([0x61, 0xc3, 0x28, 0xf0, 0x9f]);
    expect(decode(bad)).toBe(Buffer.from(bad).toString('utf8'));
  });
});

describe.each(ENCODERS)('bytesToBase64 — %s', (_name, encode) => {
  const reference = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

  it('encodes the empty array', () => {
    expect(encode(new Uint8Array(0))).toBe('');
  });

  it('matches Buffer for every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(encode(all)).toBe(reference(all));
  });

  it.each([1, 2, 3, 4])('handles padding for length %i', len => {
    const bytes = new Uint8Array(len).fill(0xff);
    expect(encode(bytes)).toBe(reference(bytes));
  });

  it('matches Buffer exactly at the btoa chunk boundary (0x8000)', () => {
    for (const len of [0x8000 - 1, 0x8000, 0x8000 + 1]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 31) & 0xff;
      expect(encode(bytes)).toBe(reference(bytes));
    }
  });

  it('matches Buffer on multi-chunk payloads (typical raster drawable)', () => {
    const bytes = new Uint8Array(0x8000 * 3 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff;
    expect(encode(bytes)).toBe(reference(bytes));
  });

  it('respects byteOffset/byteLength views over a larger buffer', () => {
    const backing = new Uint8Array([9, 9, 9, 1, 2, 3, 9, 9]);
    const view = new Uint8Array(backing.buffer, 3, 3);
    expect(encode(view)).toBe(reference(new Uint8Array([1, 2, 3])));
  });
});

describe('utf8ToBase64', () => {
  it('encodes multibyte SVG-ish markup like Buffer does', () => {
    const svg = '<svg><text>héllo 🚀</text></svg>';
    expect(utf8ToBase64(svg)).toBe(Buffer.from(svg, 'utf8').toString('base64'));
  });
});
