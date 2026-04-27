/**
 * Validates the v19 gzip snapshot format:
 *   - save() writes gzipped JSON (smaller than raw)
 *   - load() handles both gzipped (v19+) and raw (v18 legacy) bytes
 *   - round-trip preserves the snapshot data
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as zlib from 'node:zlib';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import * as IndexStore from '../../src/indexer/IndexStore';
import * as vscodeMock from './__mocks__/vscode';

const STORAGE_URI = { fsPath: '/tmp/kj-test', toString: () => 'file:///tmp/kj-test' };
const SNAPSHOT_FILENAME = 'kotlin-jump-index.json';

function makeContext(): any {
  return {
    storageUri: STORAGE_URI,
    subscriptions: [],
  };
}

let writtenBytes: Uint8Array | undefined;
const origFs: Record<string, any> = {};
let origJoinPath: any;

beforeEach(() => {
  writtenBytes = undefined;
  // The mock's workspace.fs only declares `readFile` — add the methods
  // IndexStore needs without poisoning the global mock for other tests.
  origFs.readFile = (vscodeMock.workspace.fs as any).readFile;
  origFs.writeFile = (vscodeMock.workspace.fs as any).writeFile;
  origFs.createDirectory = (vscodeMock.workspace.fs as any).createDirectory;
  (vscodeMock.workspace.fs as any).createDirectory = async () => undefined;
  (vscodeMock.workspace.fs as any).writeFile = async (_uri: any, content: any) => {
    writtenBytes = content;
  };
  (vscodeMock.workspace.fs as any).readFile = async () => {
    if (!writtenBytes) throw new Error('no snapshot');
    return writtenBytes as any;
  };
  origJoinPath = (vscodeMock.Uri as any).joinPath;
  (vscodeMock.Uri as any).joinPath = (..._args: any[]) => STORAGE_URI;
});

afterEach(() => {
  (vscodeMock.workspace.fs as any).readFile = origFs.readFile;
  (vscodeMock.workspace.fs as any).writeFile = origFs.writeFile;
  (vscodeMock.workspace.fs as any).createDirectory = origFs.createDirectory;
  (vscodeMock.Uri as any).joinPath = origJoinPath;
});

describe('IndexStore — gzip snapshot (v19)', () => {
  it('save writes gzip-compressed bytes, load round-trips', async () => {
    const index = new SymbolIndex();
    // Populate with enough data to make compression meaningful
    for (let i = 0; i < 50; i++) {
      const code = `package com.example.pkg${i}\nclass Foo${i} { fun bar${i}() {} }`;
      index.add(parse(`file:///f${i}.kt`, code));
    }
    index.finalize();

    const stats = new Map<string, { mtime: number; size: number }>();
    for (const u of index.fileUriStrings()) stats.set(u, { mtime: 1, size: 100 });

    await IndexStore.save(index, stats, makeContext());

    // 1. The bytes start with the gzip magic 0x1f 0x8b
    expect(writtenBytes, 'save() produced no bytes').toBeDefined();
    const buf = Buffer.from(writtenBytes!);
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);

    // 2. Decompressed payload is valid JSON with the right shape
    const json = zlib.gunzipSync(buf).toString('utf8');
    const snap = JSON.parse(json);
    expect(snap.version).toBe(19);
    expect(Object.keys(snap.files).length).toBe(50);

    // 3. load() round-trips — returns a non-null snapshot
    const loaded = await IndexStore.load(makeContext());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(19);
    expect(Object.keys(loaded!.files).length).toBe(50);
  });

  it('compression actually shrinks payload (>=2× ratio on realistic data)', async () => {
    const index = new SymbolIndex();
    for (let i = 0; i < 100; i++) {
      const code = `package com.example.demo
class WidgetCarousel${i} {
    fun render() = println("hello")
    fun update(state: State): State = state
    private val tag = "WidgetCarousel${i}"
}`;
      index.add(parse(`file:///WidgetCarousel${i}.kt`, code));
    }
    index.finalize();

    const stats = new Map<string, { mtime: number; size: number }>();
    for (const u of index.fileUriStrings()) stats.set(u, { mtime: 1, size: 200 });

    await IndexStore.save(index, stats, makeContext());

    const compressed = Buffer.from(writtenBytes!);
    const decompressed = zlib.gunzipSync(compressed);
    const ratio = decompressed.length / compressed.length;
    // Repetitive JSON (package names, kinds, file URIs) compresses 5-10×
    // in practice. Lower bound 2× catches a regression where compression
    // is somehow disabled or applied to incompressible data.
    expect(ratio).toBeGreaterThanOrEqual(2);
  });

  it('load() falls back to raw JSON for legacy v18 (non-gzipped) bytes', async () => {
    // Synthesise a v19 snapshot but write it as raw JSON (without gzip).
    // load() should detect the missing magic and parse as JSON.
    const rawSnap = { version: 19, files: { 'file:///x.kt': { t: 1, p: 'p', n: ['x'], k: ['fun'], l: [0], c: [0], i: [0], d: [0] } } };
    writtenBytes = Buffer.from(JSON.stringify(rawSnap), 'utf8');

    const loaded = await IndexStore.load(makeContext());
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(19);
    expect(Object.keys(loaded!.files)).toEqual(['file:///x.kt']);
  });

  it('load() returns null for missing magic + invalid JSON', async () => {
    writtenBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const loaded = await IndexStore.load(makeContext());
    expect(loaded).toBeNull();
  });
});
