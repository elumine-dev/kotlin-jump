/**
 * DrawableHoverProvider — rich tooltip for R.drawable.xxx / R.mipmap.xxx.
 *
 * Tests cover:
 *   - Cursor inside token fires hover; outside → undefined
 *   - Vector XML → SVG preview embedded
 *   - Raster (PNG/WebP) → data URI preview embedded
 *   - Multi-variant drawable → variants listed in the tooltip
 *   - Missing drawable → undefined, no throw
 *   - Non-Kotlin/Java language → skipped
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from './__mocks__/vscode';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';
import { DrawableHoverProvider } from '../../src/providers/DrawableHoverProvider';

function uri(p: string) { return { path: p, toString: () => `file://${p}` }; }

function doc(line: string, language: string = 'kotlin') {
  return {
    languageId: language,
    lineAt: (_n: number) => ({ text: line }),
  } as any;
}

// Mock workspace.fs.readFile to return bytes keyed by URI path.
let fakeFiles: Record<string, Uint8Array> = {};
beforeEach(() => {
  fakeFiles = {};
  (vscode as any).workspace.fs.readFile = async (u: any) => {
    const bytes = fakeFiles[u.path] ?? fakeFiles[u.toString?.()];
    if (!bytes) throw new Error('not found');
    return bytes;
  };
});
afterEach(() => vi.restoreAllMocks());

const VEC_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:pathData="M12,2L2,12h20Z" android:fillColor="#FF0000"/>
</vector>`;

function registerFile(idx: DrawableResourceIndex, path: string, bytes: string | Uint8Array) {
  const u = uri(path);
  idx.addFile(u);
  fakeFiles[path] = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  return u;
}

// ── KJD-DHP-1 — position gating ──────────────────────────────────────────────

describe('KJD-DHP-1 — position gating', () => {
  it('fires when cursor is inside the drawable token', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/ic.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
  });

  it('returns undefined when cursor is outside the token', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/ic.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const h = await provider.provideHover(doc('val x = R.drawable.ic'), { line: 0, character: 0 } as any);
    expect(h).toBeUndefined();
  });

  it('skips non-Kotlin/Java documents', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/ic.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line, 'typescript'), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });
});

// ── KJD-DHP-2 — preview rendering ────────────────────────────────────────────

describe('KJD-DHP-2 — preview rendering', () => {
  it('embeds an SVG data URI for vector XML drawables', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/ic_star.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic_star';
    const col = line.indexOf('ic_star');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('data:image/svg+xml;base64,');
    expect(md).toContain('ic_star');
  });

  it('embeds a PNG data URI for raster drawables', async () => {
    const idx = new DrawableResourceIndex();
    const png1x1 = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    registerFile(idx, '/r/res/drawable/pic.png', png1x1);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.pic';
    const col = line.indexOf('pic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('data:image/png;base64,');
  });

  it('supports R.mipmap.xxx the same way as R.drawable', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/mipmap-xhdpi/ic_launcher.png', Buffer.from([0x89, 0x50]));
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.mipmap.ic_launcher';
    const col = line.indexOf('ic_launcher');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
    expect((h!.contents[0] as any).value).toContain('R.mipmap.ic_launcher');
  });
});

// ── KJD-DHP-3 — multi-variant listing ────────────────────────────────────────

describe('KJD-DHP-3 — multi-variant listing', () => {
  it('lists all qualifiers when more than one variant exists', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/ic.xml', VEC_XML);
    registerFile(idx, '/r/res/drawable-night/ic.xml', VEC_XML);
    registerFile(idx, '/r/res/drawable-hdpi/ic.png', Buffer.from([0x89]));
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('Variants:');
    expect(md).toContain('drawable/xml');
    expect(md).toContain('drawable-night/xml');
    expect(md).toContain('drawable-hdpi/png');
  });

  it('omits the Variants list when there is only one', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/solo.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.solo';
    const col = line.indexOf('solo');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).not.toContain('Variants:');
  });

  it('prefers vector XML over raster for the preview when both exist', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable-hdpi/ic.png', Buffer.from([0xFF, 0xD8]));
    registerFile(idx, '/r/res/drawable/ic.xml', VEC_XML);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('data:image/svg+xml;base64,');
    expect(md).not.toContain('data:image/png;base64,');
  });
});

// ── KJD-DHP-EXT — every supported image format must render ────────────────────

describe('KJD-DHP-EXT — every file format produces a hover', () => {
  // Each format gets: valid hover object + expected MIME / format indicator
  // in the tooltip markdown. If ANY of these starts failing, the hover
  // silently shows blank images in the wild — catastrophic UX.
  const CASES: Array<{ ext: string; bytes: Uint8Array; expectInMarkdown: string }> = [
    {
      ext: 'xml', // Android vector → converted to SVG data URI
      bytes: Buffer.from(VEC_XML),
      expectInMarkdown: 'data:image/svg+xml;base64,',
    },
    {
      ext: 'png', // standard PNG
      bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      expectInMarkdown: 'data:image/png;base64,',
    },
    {
      ext: 'webp', // RIFF/WEBP header bytes
      bytes: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      expectInMarkdown: 'data:image/webp;base64,',
    },
    {
      ext: 'svg',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"></svg>'),
      expectInMarkdown: 'data:image/svg+xml;base64,',
    },
    {
      ext: 'jpg',
      bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
      expectInMarkdown: 'data:image/jpeg;base64,',
    },
    {
      ext: 'jpeg',
      bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
      expectInMarkdown: 'data:image/jpeg;base64,',
    },
    {
      ext: 'gif',
      bytes: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      expectInMarkdown: 'data:image/gif;base64,',
    },
    {
      ext: 'bmp',
      bytes: Buffer.from([0x42, 0x4D, 0x10, 0x00]),
      expectInMarkdown: 'data:image/bmp;base64,',
    },
  ];

  for (const { ext, bytes, expectInMarkdown } of CASES) {
    it(`renders ${ext} drawables with ${expectInMarkdown}`, async () => {
      const idx = new DrawableResourceIndex();
      registerFile(idx, `/r/res/drawable/asset_${ext}.${ext}`, bytes);
      const provider = new DrawableHoverProvider(idx);
      const line = `val x = R.drawable.asset_${ext}`;
      const col = line.indexOf(`asset_${ext}`);
      const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
      expect(h).toBeDefined();
      const md = (h!.contents[0] as any).value as string;
      expect(md).toContain(expectInMarkdown);
      expect(md).toContain(`R.drawable.asset_${ext}`);
    });
  }

  it('marks .9.png files with a 9-patch badge in the tooltip', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/btn_primary.9.png', Buffer.from([0x89, 0x50]));
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.btn_primary';
    const col = line.indexOf('btn_primary');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('data:image/png;base64,');
    expect(md).toContain('9-patch');
  });

  it('names the root element for non-vector XML drawables (selector/shape/layer-list)', async () => {
    const idx = new DrawableResourceIndex();
    const selectorXml = `<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:state_pressed="true" android:drawable="@color/accent"/>
</selector>`;
    registerFile(idx, '/r/res/drawable/ripple_btn.xml', selectorXml);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ripple_btn';
    const col = line.indexOf('ripple_btn');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('drawable type');
    expect(md).toContain('selector');
    // No SVG data URI for non-vector XML
    expect(md).not.toContain('data:image/svg+xml');
  });

  it('handles shape XML drawables', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/rounded_bg.xml',
      '<shape xmlns:android="http://schemas.android.com/apk/res/android"><corners android:radius="8dp"/></shape>');
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.rounded_bg';
    const col = line.indexOf('rounded_bg');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('shape');
  });

  it('handles layer-list XML drawables', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/stacked.xml',
      '<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/white"/></layer-list>');
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.stacked';
    const col = line.indexOf('stacked');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('layer-list');
  });
});

// ── KJD-DHP-4 — graceful failure ──────────────────────────────────────────────

describe('KJD-DHP-4 — graceful failure', () => {
  it('returns undefined when the drawable key is not indexed', async () => {
    const idx = new DrawableResourceIndex();
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.never';
    const col = line.indexOf('never');
    expect(await provider.provideHover(doc(line), { line: 0, character: col } as any)).toBeUndefined();
  });

  it('produces a header-only hover when the file is unreadable', async () => {
    const idx = new DrawableResourceIndex();
    const u = uri('/r/res/drawable/broken.xml');
    idx.addFile(u); // index knows about it
    // do NOT register in fakeFiles, so readFile will throw
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.broken';
    const col = line.indexOf('broken');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('R.drawable.broken');
    expect(md).not.toContain('data:image/svg+xml');
  });

  it('produces a header-only hover when the vector XML is unparseable', async () => {
    const idx = new DrawableResourceIndex();
    registerFile(idx, '/r/res/drawable/weird.xml', '<not-a-vector/>');
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.weird';
    const col = line.indexOf('weird');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('R.drawable.weird');
    expect(md).not.toContain('data:image/svg+xml');
  });
});
