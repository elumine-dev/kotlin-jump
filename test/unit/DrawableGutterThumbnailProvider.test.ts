/**
 * DrawableGutterThumbnailProvider — per-line gutter icons for R.drawable/R.mipmap.
 *
 * Checks cover: decoration placement, multi-format support (all of
 * xml/png/webp/svg/jpg/jpeg/gif/bmp/.9.png), setting toggle, missing
 * drawable, file cache reuse, dispose semantics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from './__mocks__/vscode';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';
import { DrawableGutterThumbnailProvider } from '../../src/providers/DrawableGutterThumbnailProvider';

// Capture decoration calls per editor so we can assert what got painted.
interface Capture { type: any; decorations: any[] }

function mockEditor(lines: string[], language = 'kotlin') {
  const editor = {
    document: {
      languageId: language,
      lineCount: lines.length,
      lineAt: (n: number) => ({ text: lines[n] }),
    },
    captures: [] as Capture[],
    setDecorations(type: any, decorations: any[]) {
      this.captures.push({ type, decorations });
    },
  } as any;
  return editor;
}

function uri(p: string) { return { path: p, toString: () => `file://${p}`, fsPath: p }; }

let tmpStorage: vscode.Uri;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-gutter-'));
  tmpStorage = { fsPath: tmpDir } as any;

  // Every decoration type the provider creates records its gutterIconPath
  // on the returned stub so tests can assert what image got used.
  (vscode as any).window.createTextEditorDecorationType = (opts: any) => ({
    opts, dispose: () => {},
  });
  (vscode as any).window.visibleTextEditors = [];

  // Fake fs.readFile — key is URI path.
  const fakeFiles: Record<string, Uint8Array> = {};
  (globalThis as any).__fakeFiles = fakeFiles;
  (vscode as any).workspace.fs.readFile = async (u: any) => {
    const b = fakeFiles[u.path];
    if (!b) throw new Error('not found');
    return b;
  };
  // Uri.file used internally → stub it.
  (vscode as any).Uri.file = (p: string) => ({ fsPath: p, path: p, toString: () => `file://${p}` });
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function seed(idx: DrawableResourceIndex, p: string, bytes: Buffer) {
  const u = uri(p);
  idx.addFile(u);
  (globalThis as any).__fakeFiles[p] = bytes;
}

async function flush(provider: DrawableGutterThumbnailProvider, editor: any) {
  // Set as active editor so scheduleFlush picks it up.
  (vscode as any).window.activeTextEditor = editor;
  (vscode as any).window.visibleTextEditors = [editor];
  // Trigger a refresh and wait past the 32 ms debounce.
  provider.refreshAllEditors();
  await new Promise(r => setTimeout(r, 60));
}

const VEC_XML = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="M1,1L5,5Z" android:fillColor="#FF0"/></vector>`;

// ── KJD-DGT-1 — basic placement ──────────────────────────────────────────────

describe('KJD-DGT-1 — basic placement', () => {
  it('places a decoration on the line containing R.drawable.xxx', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/ic.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic']);
    await flush(provider, editor);
    const decorated = editor.captures.filter((c: Capture) => c.decorations.length > 0);
    expect(decorated).toHaveLength(1);
    const range = decorated[0].decorations[0].range;
    expect(range.start.line).toBe(0);
    provider.dispose();
  });

  it('supports R.mipmap the same as R.drawable', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/mipmap/ic_launcher.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.mipmap.ic_launcher']);
    await flush(provider, editor);
    const decorated = editor.captures.filter((c: Capture) => c.decorations.length > 0);
    expect(decorated).toHaveLength(1);
    provider.dispose();
  });

  it('places multiple decorations when a line references two drawables', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/a.xml', Buffer.from(VEC_XML));
    seed(idx, '/r/res/drawable/b.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['setIcon(if (s) R.drawable.a else R.drawable.b)']);
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: Capture) => n + c.decorations.length, 0);
    expect(total).toBe(2);
    provider.dispose();
  });
});

// ── KJD-DGT-2 — every format caches to disk ──────────────────────────────────

describe('KJD-DGT-2 — caches every supported file format to disk', () => {
  const FORMATS = [
    { ext: 'xml',  bytes: Buffer.from(VEC_XML), cachedExt: 'svg' },
    { ext: 'png',  bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47]),  cachedExt: 'png' },
    { ext: 'webp', bytes: Buffer.from([0x52, 0x49, 0x46, 0x46]),  cachedExt: 'webp' },
    { ext: 'svg',  bytes: Buffer.from('<svg/>'),                  cachedExt: 'svg' },
    { ext: 'jpg',  bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),  cachedExt: 'jpg' },
    { ext: 'jpeg', bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),  cachedExt: 'jpeg' },
    { ext: 'gif',  bytes: Buffer.from([0x47, 0x49, 0x46, 0x38]),  cachedExt: 'gif' },
    { ext: 'bmp',  bytes: Buffer.from([0x42, 0x4D, 0x10, 0x00]),  cachedExt: 'bmp' },
  ];

  for (const { ext, bytes, cachedExt } of FORMATS) {
    it(`caches a thumbnail for .${ext} drawables`, async () => {
      const idx = new DrawableResourceIndex();
      seed(idx, `/r/res/drawable/asset_${ext}.${ext}`, bytes);
      const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
      const editor = mockEditor([`val x = R.drawable.asset_${ext}`]);
      await flush(provider, editor);
      const cached = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
      expect(cached.some(f => f.endsWith(`.${cachedExt}`))).toBe(true);
      provider.dispose();
    });
  }

  it('caches 9-patch PNGs as regular .png', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/btn.9.png', Buffer.from([0x89, 0x50]));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.btn']);
    await flush(provider, editor);
    const cached = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(cached.some(f => f.endsWith('.png'))).toBe(true);
    provider.dispose();
  });
});

// ── KJD-DGT-3 — setting toggle ───────────────────────────────────────────────

describe('KJD-DGT-3 — setting toggle', () => {
  it('paints nothing when kotlinJump.drawableThumbnails = false', async () => {
    (vscode as any).workspace.getConfiguration = () => ({
      get: (_k: string, def: any) => (_k === 'drawableThumbnails' ? false : def),
    });
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/ic.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic']);
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: Capture) => n + c.decorations.length, 0);
    expect(total).toBe(0);
    provider.dispose();
  });

  it('skips non-Kotlin/Java documents', async () => {
    (vscode as any).workspace.getConfiguration = () => ({ get: (_k: string, def: any) => def });
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/ic.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic'], 'typescript');
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: Capture) => n + c.decorations.length, 0);
    expect(total).toBe(0);
    provider.dispose();
  });
});

// ── KJD-DGT-4 — robustness ───────────────────────────────────────────────────

describe('KJD-DGT-4 — robustness', () => {
  it('skips unknown drawable keys without crashing', async () => {
    (vscode as any).workspace.getConfiguration = () => ({ get: (_k: string, def: any) => def });
    const idx = new DrawableResourceIndex();
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.never_registered']);
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: Capture) => n + c.decorations.length, 0);
    expect(total).toBe(0);
    provider.dispose();
  });

  it('skips drawables whose files are unreadable', async () => {
    const idx = new DrawableResourceIndex();
    const u = uri('/r/res/drawable/broken.xml');
    idx.addFile(u); // register but do NOT seed bytes
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.broken']);
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: Capture) => n + c.decorations.length, 0);
    expect(total).toBe(0);
    provider.dispose();
  });

  it('reuses the cached thumbnail on a second flush (no duplicate write)', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/ic.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic']);
    await flush(provider, editor);
    const firstList = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    const mtime1 = fs.statSync(path.join(tmpDir, 'drawable-thumbs', firstList[0])).mtimeMs;
    await flush(provider, editor);
    const mtime2 = fs.statSync(path.join(tmpDir, 'drawable-thumbs', firstList[0])).mtimeMs;
    expect(mtime2).toBe(mtime1);
    provider.dispose();
  });

  it('invalidatePath removes cached file for a changed drawable', async () => {
    const idx = new DrawableResourceIndex();
    seed(idx, '/r/res/drawable/ic.xml', Buffer.from(VEC_XML));
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic']);
    await flush(provider, editor);
    expect(fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'))).toHaveLength(1);
    provider.invalidatePath({ path: '/r/res/drawable/ic.xml' } as any);
    expect(fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'))).toHaveLength(0);
    provider.dispose();
  });

  it('dispose releases all decoration types', () => {
    const idx = new DrawableResourceIndex();
    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    expect(() => provider.dispose()).not.toThrow();
  });
});

// ── KJD-DGT-5 — cache invalidation across saves ──────────────────────────────
// Bug: after editing ic_pokeball.xml and saving, the gutter thumbnails on
// R.drawable.ic_pokeball references in OTHER files kept showing stale colors.
// Root cause: cache filename was path-based, so the gutter icon URI never
// changed across saves — VS Code's internal image cache kept the old bitmap.
// Fix: encode the source mtime in the cache filename so each version of the
// source maps to a distinct on-disk path (and a distinct URI for VS Code).

describe('KJD-DGT-5 — cache invalidation across saves (real fs, mtime-keyed)', () => {
  function realSourceXml(name: string, content: string): { uri: any; fsPath: string } {
    // Path must include `/res/drawable/` for the dirty-XML detection regex
    // to match. Use a unique parent dir per fixture to avoid collisions.
    const fsPath = path.join(tmpDir, `proj-${name}`, 'res', 'drawable', `${name}.xml`);
    fs.mkdirSync(path.dirname(fsPath), { recursive: true });
    fs.writeFileSync(fsPath, content);
    const uri = { path: fsPath, fsPath, toString: () => `file://${fsPath}` };
    (globalThis as any).__fakeFiles[fsPath] = Buffer.from(content);
    return { uri, fsPath };
  }

  it('encodes source mtime in the cache filename', async () => {
    const idx = new DrawableResourceIndex();
    const { uri: u } = realSourceXml('ic_one', VEC_XML);
    idx.addFile(u);

    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic_one']);
    await flush(provider, editor);

    const cached = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(cached).toHaveLength(1);
    // Filename pattern: <16 hex>-<mtimeMs>.svg
    expect(cached[0]).toMatch(/^[0-9a-f]{16}-\d+\.svg$/);
    provider.dispose();
  });

  it('changing source content + mtime produces a NEW cache filename and retires the old', async () => {
    const idx = new DrawableResourceIndex();
    const { uri: u, fsPath } = realSourceXml('ic_two', VEC_XML);
    idx.addFile(u);

    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic_two']);
    await flush(provider, editor);

    const cacheDir = path.join(tmpDir, 'drawable-thumbs');
    const firstList = fs.readdirSync(cacheDir);
    expect(firstList).toHaveLength(1);
    const firstPath = path.join(cacheDir, firstList[0]);

    // Simulate a save: rewrite the XML with a different colour AND bump
    // the mtime forward (some filesystems have 1s mtime granularity, so
    // an immediate rewrite can land in the same mtime bucket).
    const updated = VEC_XML.replace('#FF0', '#0FF');
    fs.writeFileSync(fsPath, updated);
    (globalThis as any).__fakeFiles[fsPath] = Buffer.from(updated);
    const future = (Date.now() + 5000) / 1000;
    fs.utimesSync(fsPath, future, future);

    // Trigger an invalidation (matches what the file watcher / save listener
    // does in production).
    provider.invalidatePath({ path: fsPath, toString: () => `file://${fsPath}` } as any);
    await new Promise(r => setTimeout(r, 60));

    const secondList = fs.readdirSync(cacheDir);
    expect(secondList).toHaveLength(1);
    expect(secondList[0]).not.toBe(firstList[0]);     // different filename
    expect(fs.existsSync(firstPath)).toBe(false);     // old cache file deleted
    provider.dispose();
  });

  it('reads dirty editor text instead of disk when the XML is open with unsaved edits', async () => {
    const idx = new DrawableResourceIndex();
    const stalePath = path.join(tmpDir, 'proj-dirty', 'res', 'drawable', 'ic_dirty.xml');
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, VEC_XML);
    const stalePathU = { path: stalePath, fsPath: stalePath, toString: () => `file://${stalePath}` };
    idx.addFile(stalePathU);
    (globalThis as any).__fakeFiles[stalePath] = Buffer.from(VEC_XML);

    // Capture the listener registrations so we can fire change events at will.
    const listeners: Array<(e: any) => void> = [];
    (vscode as any).workspace.onDidChangeTextDocument = (cb: any) => {
      listeners.push(cb);
      return { dispose: () => {} };
    };

    const newSvg = VEC_XML.replace('#FF0', '#F0F');
    const dirtyDoc = {
      uri: { ...stalePathU },
      isDirty: true,
      version: 7,
      getText: () => newSvg,
    };
    (vscode as any).workspace.textDocuments = [dirtyDoc];

    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    // Simulate the editor firing the dirty-doc event so the provider's
    // listener marks the URI as dirty in its O(1) Set.
    for (const l of listeners) l({ document: dirtyDoc });

    const editor = mockEditor(['val x = R.drawable.ic_dirty']);
    await flush(provider, editor);

    // Cache filename should use doc.version, not mtime
    const cached = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatch(/^[0-9a-f]{16}-doc7\.svg$/);

    // And the cached SVG must reflect the IN-MEMORY text, not the on-disk text.
    const cachedSvg = fs.readFileSync(path.join(tmpDir, 'drawable-thumbs', cached[0]), 'utf8');
    expect(cachedSvg).toContain('#F0F');                  // from dirty doc
    expect(cachedSvg).not.toContain('#FF0');              // disk version, must be ignored
    provider.dispose();
  });

  it('hot path performs zero disk writes when the cache is verified (no perf regression)', async () => {
    const idx = new DrawableResourceIndex();
    const { uri: u } = realSourceXml('ic_hot', VEC_XML);
    idx.addFile(u);

    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);
    const editor = mockEditor(['val x = R.drawable.ic_hot']);
    await flush(provider, editor);                                        // primes the cache

    const cacheDir   = path.join(tmpDir, 'drawable-thumbs');
    const list1      = fs.readdirSync(cacheDir);
    expect(list1).toHaveLength(1);
    const cacheFile  = path.join(cacheDir, list1[0]);
    const mtimeBefore = fs.statSync(cacheFile).mtimeMs;
    const inoBefore   = fs.statSync(cacheFile).ino;

    // Hammer the provider with 5 hot-path flushes — same content, no save.
    // The cache file's mtime AND inode must be unchanged: no rewrite, no
    // atomic-rename swap, no fs.writeFile under the hood.
    for (let i = 0; i < 5; i++) await flush(provider, editor);

    const list2 = fs.readdirSync(cacheDir);
    expect(list2).toEqual(list1);                                         // no new entries
    const mtimeAfter = fs.statSync(cacheFile).mtimeMs;
    const inoAfter   = fs.statSync(cacheFile).ino;
    expect(mtimeAfter).toBe(mtimeBefore);                                 // never re-written
    expect(inoAfter).toBe(inoBefore);                                     // never atomic-renamed
    provider.dispose();
  });

  it('invalidatePath also clears the dirty marker so a stale dirty render does not survive a save', async () => {
    const idx = new DrawableResourceIndex();
    const fsPath = path.join(tmpDir, 'proj-iv', 'res', 'drawable', 'ic_iv.xml');
    fs.mkdirSync(path.dirname(fsPath), { recursive: true });
    fs.writeFileSync(fsPath, VEC_XML);
    const u = { path: fsPath, fsPath, toString: () => `file://${fsPath}` };
    idx.addFile(u);
    (globalThis as any).__fakeFiles[fsPath] = Buffer.from(VEC_XML);

    const listeners: Array<(e: any) => void> = [];
    (vscode as any).workspace.onDidChangeTextDocument = (cb: any) => {
      listeners.push(cb); return { dispose: () => {} };
    };

    const provider = new DrawableGutterThumbnailProvider(idx, tmpStorage);

    // Mark dirty
    const dirtyDoc = { uri: u, isDirty: true, version: 3, getText: () => VEC_XML.replace('#FF0', '#ABC') };
    (vscode as any).workspace.textDocuments = [dirtyDoc];
    for (const l of listeners) l({ document: dirtyDoc });

    // Simulate save: file watcher (or save listener) calls invalidatePath
    provider.invalidatePath({ path: fsPath, toString: () => `file://${fsPath}` } as any);

    // Now a flush with the doc still flagged "isDirty=false" (saved state)
    // should fall back to the disk path, NOT keep using the dirty render.
    const savedDoc = { uri: u, isDirty: false, version: 4, getText: () => VEC_XML };
    (vscode as any).workspace.textDocuments = [savedDoc];

    const editor = mockEditor(['val x = R.drawable.ic_iv']);
    await flush(provider, editor);
    const cached = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(cached).toHaveLength(1);
    // Filename must be mtime-versioned, not doc-versioned, after invalidate
    expect(cached[0]).toMatch(/^[0-9a-f]{16}-\d+\.svg$/);
    expect(cached[0]).not.toMatch(/-doc\d+\.svg$/);
    provider.dispose();
  });
});
