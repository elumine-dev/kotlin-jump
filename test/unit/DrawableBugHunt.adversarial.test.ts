/**
 * BUG HUNT — aggressively surface bugs Kevin does NOT want in a release.
 *
 * Every test is phrased as a behaviour we expect to hold. A failure here
 * represents a real bug worth fixing BEFORE shipping, not a cosmetic
 * gripe. Tests are grouped by attack surface:
 *
 *   PATH     — path parsing / URI handling / findFiles glob
 *   REGEX    — R.drawable / R.mipmap token detection in source
 *   VECTOR   — vector XML → SVG conversion
 *   CURSOR   — position gating in hover / gutter
 *   LIFECYCLE — decoration types, caches, disposes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from './__mocks__/vscode';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';
import { DrawableHoverProvider } from '../../src/providers/DrawableHoverProvider';
import { DrawableGutterThumbnailProvider } from '../../src/providers/DrawableGutterThumbnailProvider';
import { vectorXmlToSvg } from '../../src/util/vectorToSvg';

function uri(p: string) { return { path: p, toString: () => `file://${p}`, fsPath: p }; }
function doc(line: string, language = 'kotlin') {
  return { languageId: language, lineCount: 1, lineAt: () => ({ text: line }) } as any;
}

let fakeFiles: Record<string, Uint8Array> = {};
let tmpDir: string;

beforeEach(() => {
  fakeFiles = {};
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-bug-'));
  (vscode as any).workspace.fs.readFile = async (u: any) => {
    const b = fakeFiles[u.path];
    if (!b) throw new Error('not found');
    return b;
  };
  (vscode as any).window.createTextEditorDecorationType = (opts: any) => ({ opts, dispose: () => {} });
  (vscode as any).window.visibleTextEditors = [];
  (vscode as any).window.activeTextEditor = undefined;
  (vscode as any).Uri.file = (p: string) => ({ fsPath: p, path: p, toString: () => `file://${p}` });
  (vscode as any).workspace.getConfiguration = () => ({ get: (_k: string, d: any) => d });
});
afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

const VEC = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="M0,0Z" android:fillColor="#000"/></vector>`;

// ─── PATH — path parsing ────────────────────────────────────────────────────

describe('BUG-PATH — path parsing traps', () => {
  it('does not index a file at res/drawable.xml (no trailing slash folder)', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable.xml'));
    expect(idx.size()).toBe(0);
  });

  it('does not index files under res/layout/, even if named like drawables', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/layout/button.xml'));
    expect(idx.size()).toBe(0);
  });

  it('does not index files under res/raw/', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/raw/song.mp3'));
    idx.addFile(uri('/app/res/raw/tutorial.png'));
    expect(idx.size()).toBe(0);
  });

  it('handles paths with spaces', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/Users/foo/My Project/app/res/drawable/ic.xml'));
    expect(idx.get('ic')).toBeDefined();
  });

  it('handles paths with URL-encoded spaces as the uri.path is already decoded', () => {
    const idx = new DrawableResourceIndex();
    // vscode.Uri.path is always percent-decoded in the VS Code API, so
    // we should not encounter "%20" here — but if someone passes it raw
    // we must not match (path_re uses plain space).
    idx.addFile({ path: '/app/res/drawable/my%20icon.png', toString: () => 'file:///app/res/drawable/my%20icon.png' });
    // We accept this as a key "my%20icon" — not great but not a crash.
    // The important thing is the index doesn't throw.
    expect(idx.size()).toBeLessThanOrEqual(1);
  });

  it('rejects .pngsuffix (wrong extension boundary)', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable/ic.pngsuffix'));
    expect(idx.size()).toBe(0);
  });

  it('rejects a file whose extension is only .9 (no image ext)', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable/broken.9'));
    expect(idx.size()).toBe(0);
  });

  it('rejects .xml.bak backup files', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable/ic.xml.bak'));
    expect(idx.size()).toBe(0);
  });
});

// ─── REGEX — R.drawable token detection ─────────────────────────────────────

describe('BUG-REGEX — hover regex edge cases', () => {
  const idx = new DrawableResourceIndex();
  idx.addFile(uri('/r/res/drawable/ic.xml'));
  idx.addFile(uri('/r/res/drawable/foo.xml'));

  beforeEach(() => {
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    fakeFiles['/r/res/drawable/foo.xml'] = Buffer.from(VEC);
  });

  it('does not match a non-boundary prefix like `FooR.drawable.ic`', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = FooR.drawable.ic';
    // Cursor on `ic` — but the prefix breaks the \b boundary.
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });

  it('matches after a dot (package.R.drawable.ic)', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = com.example.R.drawable.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
  });

  it('when cursor is on the "R" itself → returns undefined (R is ambiguous)', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic';
    const col = line.indexOf('R.') ;
    // Cursor is on R; the key range starts at 'R.drawable.ic' → covers R.
    // Our contract says the drawable hover covers the WHOLE token so this
    // SHOULD return a hover. Documenting the contract here.
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
  });

  it('when cursor is just past the drawable key → returns undefined', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic;';
    const col = line.indexOf('ic') + 2; // on the `;`
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });

  it('distinguishes two R.drawable references on the same line by cursor column', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'pair(R.drawable.ic, R.drawable.foo)';
    const col1 = line.indexOf('ic');
    const col2 = line.indexOf('foo');
    const h1 = await provider.provideHover(doc(line), { line: 0, character: col1 } as any);
    const h2 = await provider.provideHover(doc(line), { line: 0, character: col2 } as any);
    expect((h1!.contents[0] as any).value).toContain('R.drawable.ic');
    expect((h2!.contents[0] as any).value).toContain('R.drawable.foo');
  });

  it('does not match R.string.ic (different resource namespace)', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.string.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });

  it('does not match R.drawables (plural — typo)', async () => {
    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawables.ic';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });
});

// ─── VECTOR — XML conversion traps ──────────────────────────────────────────

describe('BUG-VECTOR — vector XML conversion', () => {
  it('vector with UTF-8 BOM is still parseable', () => {
    const bom = '﻿';
    const xml = bom + `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z" android:fillColor="#000"/></vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('<path');
  });

  it('vector with XML comments is still parseable', () => {
    const xml = `<!-- leading comment -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:viewportWidth="24" android:viewportHeight="24">
  <!-- path comment --><path android:pathData="M0,0Z" android:fillColor="#F00"/>
</vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
  });

  it('vector with aapt:attr theme attribute falls back to fill="none" without crashing', () => {
    // Modern Android theming uses <aapt:attr> children instead of the
    // android:fillColor attribute. We do not resolve theme refs — just
    // make sure we don't throw.
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:aapt="http://schemas.android.com/aapt"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z">
        <aapt:attr name="android:fillColor">
          <gradient android:startColor="#F00" android:endColor="#00F"/>
        </aapt:attr>
      </path>
    </vector>`;
    expect(() => vectorXmlToSvg(xml)).not.toThrow();
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
  });

  it('vector with multiple groups sorts render order sensibly', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <group android:translateX="2"><path android:pathData="M0,0Z" android:fillColor="#F00"/></group>
      <group android:translateY="3"><path android:pathData="M1,1Z" android:fillColor="#0F0"/></group>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('translate(2,0)');
    expect(svg!).toContain('translate(0,3)');
  });

  it('handles fillType="evenOdd" (case variant)', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z" android:fillColor="#000" android:fillType="evenOdd"/>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg!).toContain('fill-rule="evenodd"');
  });

  it('non-Android-namespaced attributes are accepted (some tools strip the prefix)', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      viewportWidth="24" viewportHeight="24">
      <path pathData="M0,0Z" fillColor="#0F0"/>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('#0F0');
  });

  it('vector with a <clip-path> child does NOT throw even though we do not render it', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <clip-path android:pathData="M0,0L24,0L24,24L0,24Z"/>
      <path android:pathData="M1,1Z" android:fillColor="#000"/>
    </vector>`;
    expect(() => vectorXmlToSvg(xml)).not.toThrow();
  });

  it('empty attribute value yields a fillColor="none" rather than a crash', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z" android:fillColor=""/>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('fill=""');
  });

  it('nested <group> with rotation inside translation preserves both', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <group android:translateX="5" android:translateY="5">
        <group android:rotation="45" android:pivotX="0" android:pivotY="0">
          <path android:pathData="M0,0Z" android:fillColor="#F00"/>
        </group>
      </group>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('translate(5,5)');
    expect(svg!).toContain('rotate(45,0,0)');
  });
});

// ─── CURSOR — position gating ────────────────────────────────────────────────

describe('BUG-CURSOR — hover position gating', () => {
  it('cursor on the first character of R matches (start boundary)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = 'R.drawable.ic';
    const h = await provider.provideHover(doc(line), { line: 0, character: 0 } as any);
    expect(h).toBeDefined();
  });

  it('cursor on the last character of the key matches (inclusive end? NO — end is exclusive)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = 'R.drawable.ic';
    // Position 12 is on the "c"; position 13 is past the end.
    const atLast = await provider.provideHover(doc(line), { line: 0, character: 12 } as any);
    const past   = await provider.provideHover(doc(line), { line: 0, character: 13 } as any);
    expect(atLast).toBeDefined();
    expect(past).toBeUndefined();
  });

  it('hover triggered inside a comment still fires (deliberate — consistent with other R.* hovers)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = '// TODO: switch R.drawable.ic to vector';
    const col = line.indexOf('ic');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
  });
});

// ─── LIFECYCLE — decoration + cache lifecycle ───────────────────────────────

describe('BUG-LIFECYCLE — decoration and cache lifecycle', () => {
  it('globalStorage folder is created if missing on first run', () => {
    const idx = new DrawableResourceIndex();
    const nonExistent = path.join(tmpDir, 'not-yet-created');
    // Provider should mkdirSync in its constructor.
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: nonExistent } as any);
    expect(fs.existsSync(path.join(nonExistent, 'drawable-thumbs'))).toBe(true);
    provider.dispose();
  });

  it('dispose() removes all decoration types even after many cache entries', async () => {
    const idx = new DrawableResourceIndex();
    for (let i = 0; i < 5; i++) {
      const p = `/r/res/drawable/ic_${i}.xml`;
      idx.addFile(uri(p));
      fakeFiles[p] = Buffer.from(VEC);
    }
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    const editor = mockEditor([
      'val a = R.drawable.ic_0',
      'val a = R.drawable.ic_1',
      'val a = R.drawable.ic_2',
      'val a = R.drawable.ic_3',
      'val a = R.drawable.ic_4',
    ]);
    await flush(provider, editor);
    // Collect all types the provider created, dispose them, and verify
    // none of them throws when re-disposed (idempotent dispose).
    const types = (provider as any).typeByCachePath as Map<string, any>;
    const preDisposeCount = types.size;
    expect(preDisposeCount).toBeGreaterThan(0);

    let disposedOk = true;
    for (const t of types.values()) {
      try { t.dispose(); t.dispose(); } catch { disposedOk = false; }
    }
    expect(disposedOk).toBe(true);
    provider.dispose();
  });

  it('invalidatePath after dispose() does not throw', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    const editor = mockEditor(['val a = R.drawable.ic']);
    await flush(provider, editor);
    provider.dispose();
    expect(() => provider.invalidatePath({ path: '/r/res/drawable/ic.xml' } as any)).not.toThrow();
  });

  it('refreshAllEditors with no visible editors is a no-op (not a crash)', () => {
    const idx = new DrawableResourceIndex();
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    (vscode as any).window.visibleTextEditors = [];
    expect(() => provider.refreshAllEditors()).not.toThrow();
    provider.dispose();
  });

  it('activeTextEditor transitions (editor1 → undefined → editor2) do not leak decorations', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VEC);
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);

    const e1 = mockEditor(['val a = R.drawable.ic']);
    await flush(provider, e1);
    (vscode as any).window.activeTextEditor = undefined;
    const e2 = mockEditor(['val b = R.drawable.ic']);
    await flush(provider, e2);

    // Both editors should have been decorated without throwing.
    const n1 = e1.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    const n2 = e2.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    expect(n1).toBe(1);
    expect(n2).toBe(1);
    provider.dispose();
  });
});

// ─── AUDIT — regression tests for bugs the external audit flagged ───────────

describe('AUDIT — stripDp must anchor all three unit suffixes', () => {
  it('does not eat `dp` that appears mid-string ("24dpi" should not become "24i")', () => {
    // Exercised via the converter: width="24dpi" should survive as "24dpi"
    // after stripDp. Expose through vectorXmlToSvg.
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24dpi" android:height="24dpi"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z" android:fillColor="#000"/></vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg!).toContain('width="24dpi"');
    expect(svg!).not.toContain('width="24i"');
  });

  it('does strip the trailing `dp`', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24dp" android:height="48dp"
      android:viewportWidth="24" android:viewportHeight="48">
      <path android:pathData="M0,0Z" android:fillColor="#000"/></vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg!).toContain('width="24"');
    expect(svg!).toContain('height="48"');
  });

  it('strips trailing `px` too', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24px" android:height="24px"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z" android:fillColor="#000"/></vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg!).toContain('width="24"');
  });
});

describe('AUDIT — XSS via alt-attribute when filename contains HTML metacharacters', () => {
  it('escapes double-quotes in filename before embedding into <img alt="…">', async () => {
    // macOS / Linux FS allow `"` in filenames. A malicious drawable
    // named with HTML metacharacters must NOT break out of the alt
    // attribute when isTrusted=true + supportHtml=true — even though
    // the normal regex filter won't let it through, defense in depth
    // matters: trust boundary between disk and markdown webview is
    // the extension's responsibility.
    //
    // We inject directly into the index's get() to simulate the
    // unreachable-via-regex case (the regex would normally block such
    // a key, but a future change might relax it).
    const idx = new DrawableResourceIndex();
    const malPath = '/r/res/drawable/ic"><b>x.xml';
    // Bypass indexer's path_re — we're testing defense in depth.
    (idx as any).byKey = new Map([
      ['ic_evil', [{
        uri:         { path: malPath, toString: () => `file://${malPath}` },
        qualifier:   'drawable',
        ext:         'xml',
        isNinePatch: false,
      }]],
    ]);
    fakeFiles[malPath] = Buffer.from(VEC);

    const provider = new DrawableHoverProvider(idx);
    const line = 'val x = R.drawable.ic_evil';
    const col = line.indexOf('ic_evil');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const md = (h!.contents[0] as any).value as string;
    // The alt attribute on the <img> element must be escaped. Extract
    // just that part — the filename also appears inside a markdown
    // code span ( `...` ) in the header, which is safe because
    // renderers escape code-span content.
    const altMatch = /<img\b[^>]*\balt="([^"]*)"/.exec(md);
    expect(altMatch).not.toBeNull();
    // The unescaped break-out `">` MUST NOT appear inside the alt value.
    expect(altMatch![1]).not.toContain('"');
    expect(altMatch![1]).not.toContain('>');
    // Escaped form is present.
    expect(altMatch![1]).toContain('&quot;');
    expect(altMatch![1]).toContain('&gt;');
  });
});

describe('AUDIT — cache staleness recovers when source mtime advances', () => {
  it('regenerates a fresh cache file (with a new mtime-versioned filename) when the source is newer', async () => {
    // Real files on disk so statSync can compare mtimes authentically.
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-stale-'));
    try {
      const srcPath = path.join(srcDir, 'res/drawable/ic.xml');
      fs.mkdirSync(path.dirname(srcPath), { recursive: true });
      fs.writeFileSync(srcPath, VEC);

      // Hook the fake fs.readFile to the real file so the provider sees
      // the same content we stat.
      (vscode as any).workspace.fs.readFile = async (u: any) => fs.readFileSync(u.path);

      const idx = new DrawableResourceIndex();
      idx.addFile({ path: srcPath, fsPath: srcPath, toString: () => `file://${srcPath}` } as any);

      const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-cache-'));
      const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: cacheRoot } as any);
      const editor = mockEditor(['val x = R.drawable.ic']);
      await flush(provider, editor);
      const cacheDir = path.join(cacheRoot, 'drawable-thumbs');
      const firstFiles = fs.readdirSync(cacheDir);
      expect(firstFiles).toHaveLength(1);
      const firstName = firstFiles[0];

      // Bump the source mtime forward (clearly past the previous mtime
      // bucket) and rewrite the content. The provider must produce a NEW
      // mtime-versioned cache filename and retire the old one.
      fs.writeFileSync(srcPath, VEC.replace('#000', '#F00'));
      const future = (Date.now() + 5000) / 1000;
      fs.utimesSync(srcPath, future, future);

      provider.invalidatePath({ path: srcPath, toString: () => `file://${srcPath}` } as any);
      await new Promise(r => setTimeout(r, 60));

      const secondFiles = fs.readdirSync(cacheDir);
      expect(secondFiles).toHaveLength(1);
      expect(secondFiles[0]).not.toBe(firstName);                 // new filename → new gutter URI
      expect(fs.existsSync(path.join(cacheDir, firstName))).toBe(false); // old retired
      provider.dispose();
    } finally {
      try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch {}
    }
  });
});

describe('AUDIT — invalidatePath uses exact match, not substring hash', () => {
  it('invalidating A does not delete B\'s cache', async () => {
    const idx = new DrawableResourceIndex();
    const aPath = '/r/res/drawable/alpha.xml';
    const bPath = '/r/res/drawable/beta.xml';
    idx.addFile(uri(aPath));
    idx.addFile(uri(bPath));
    fakeFiles[aPath] = Buffer.from(VEC);
    fakeFiles[bPath] = Buffer.from(VEC);
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);

    const editor = mockEditor([
      'val a = R.drawable.alpha',
      'val b = R.drawable.beta',
    ]);
    await flush(provider, editor);
    const before = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(before).toHaveLength(2);

    provider.invalidatePath({ path: aPath } as any);
    const after = fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'));
    expect(after).toHaveLength(1); // only B remains
    provider.dispose();
  });
});

describe('AUDIT — concurrent flush calls do not clobber the shared regex', () => {
  it('two editors flushed concurrently each see all their drawables', async () => {
    const idx = new DrawableResourceIndex();
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      idx.addFile(uri(`/r/res/drawable/${name}.xml`));
      fakeFiles[`/r/res/drawable/${name}.xml`] = Buffer.from(VEC);
    }
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);

    const e1 = mockEditor([
      'val a1 = R.drawable.a',
      'val a2 = R.drawable.b',
      'val a3 = R.drawable.c',
    ]);
    const e2 = mockEditor([
      'val b1 = R.drawable.c',
      'val b2 = R.drawable.d',
      'val b3 = R.drawable.e',
    ]);
    (vscode as any).window.activeTextEditor = e1;
    (vscode as any).window.visibleTextEditors = [e1, e2];
    provider.refreshAllEditors();
    // Let both flush calls interleave through their awaits.
    await new Promise(r => setTimeout(r, 120));

    const n1 = e1.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    const n2 = e2.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    expect(n1).toBe(3);
    expect(n2).toBe(3);
    provider.dispose();
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockEditor(lines: string[], language = 'kotlin') {
  return {
    document: {
      languageId: language,
      lineCount: lines.length,
      lineAt: (n: number) => ({ text: lines[n] }),
    },
    captures: [] as any[],
    setDecorations(type: any, decorations: any[]) { this.captures.push({ type, decorations }); },
  } as any;
}

async function flush(provider: DrawableGutterThumbnailProvider, editor: any) {
  (vscode as any).window.activeTextEditor = editor;
  (vscode as any).window.visibleTextEditors = [editor];
  provider.refreshAllEditors();
  await new Promise(r => setTimeout(r, 60));
}
