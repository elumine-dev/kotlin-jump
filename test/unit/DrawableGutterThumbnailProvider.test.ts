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
