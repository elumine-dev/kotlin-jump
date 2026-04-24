/**
 * ADV — DrawableResourceIndex + DrawableHoverProvider + DrawableGutter.
 *
 * Goal: break the chain with inputs a careless contributor would ship
 * to a PR "just to silence the test". Every test here failed at least
 * once during authoring and revealed a real bug or sharp edge that
 * warrants a guard in production code.
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-adv-'));
  (vscode as any).workspace.fs.readFile = async (u: any) => {
    const b = fakeFiles[u.path];
    if (!b) throw new Error('not found');
    return b;
  };
  (vscode as any).window.createTextEditorDecorationType = (opts: any) => ({ opts, dispose: () => {} });
  (vscode as any).window.visibleTextEditors = [];
  (vscode as any).Uri.file = (p: string) => ({ fsPath: p, path: p, toString: () => `file://${p}` });
});
afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── ADV-DRI — index path parsing edge cases ──────────────────────────────────

describe('ADV-DRI — pathological path parsing', () => {
  it('ignores drawable files nested in unrelated folders', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/some/drawable/not-under-res.png'));
    idx.addFile(uri('/app/res-backup/drawable/fake.png'));
    expect(idx.size()).toBe(0);
  });

  it('ignores drawable/ inside another drawable/ (deep nesting)', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable/subfolder/ic.png'));
    expect(idx.size()).toBe(0);
  });

  it('accepts unicode drawable names', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/res/drawable/icône_café.png'));
    // Android would actually reject this at build time, but the index
    // should not crash and should not index it incorrectly either.
    // Our regex only allows \w chars in the KEY group but the path_re
    // allows [^/]+. We accept it, and the hover regex R_DRAWABLE_RE
    // uses [A-Za-z_]\w* so such keys simply never match in Kotlin code.
    // The invariant we care about: the index doesn't throw.
    expect(idx.size()).toBeLessThanOrEqual(1);
  });

  it('treats trailing .9.PNG (uppercase) as a 9-patch', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/btn.9.PNG'));
    expect(idx.get('btn')!.variants[0].isNinePatch).toBe(true);
  });

  it('does not confuse `anim/` or `animator/` with drawable', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/anim/fade_in.xml'));
    idx.addFile(uri('/r/res/animator/fade.xml'));
    expect(idx.size()).toBe(0);
  });
});

// ── ADV-VEC — vector XML → SVG converter under hostile inputs ─────────────────

describe('ADV-VEC — vector converter hostile inputs', () => {
  it('returns undefined for empty input', () => {
    expect(vectorXmlToSvg('')).toBeUndefined();
  });

  it('returns undefined for plain text (no XML)', () => {
    expect(vectorXmlToSvg('hello world')).toBeUndefined();
  });

  it('returns undefined for a selector XML (not a vector)', () => {
    const xml = `<selector xmlns:android="http://schemas.android.com/apk/res/android"/>`;
    expect(vectorXmlToSvg(xml)).toBeUndefined();
  });

  it('returns undefined for a vector with no <path> children', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24"></vector>`;
    // Empty vector → no paths → conversion treats it as nothing to render.
    expect(vectorXmlToSvg(xml)).toBeUndefined();
  });

  it('escapes quote characters in pathData attribute', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData='M12,2L"quote"Z' android:fillColor="#FF0000"/>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    // The dangerous character must be escaped — no raw " in the attribute.
    expect(svg!).toContain('&quot;');
  });

  it('strips dp/sp/px suffixes from width/height', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:width="24dp" android:height="24dp"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="M0,0Z"/>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('width="24"');
    expect(svg!).not.toContain('width="24dp"');
  });

  it('handles <group> with rotation + pivot', () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <group android:rotation="45" android:pivotX="12" android:pivotY="12">
        <path android:pathData="M0,0Z" android:fillColor="#000"/>
      </group>
    </vector>`;
    const svg = vectorXmlToSvg(xml);
    expect(svg).toBeDefined();
    expect(svg!).toContain('rotate(45,12,12)');
  });

  it('survives a massive pathData blob without throwing', () => {
    const longPath = 'M0,0' + 'L1,1'.repeat(50_000) + 'Z';
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
      android:viewportWidth="24" android:viewportHeight="24">
      <path android:pathData="${longPath}" android:fillColor="#000"/>
    </vector>`;
    expect(() => vectorXmlToSvg(xml)).not.toThrow();
  });
});

// ── ADV-DHP — hover under pathological conditions ────────────────────────────

describe('ADV-DHP — hover under stress', () => {
  it('returns the correct drawable when two R.drawable appear on the same line', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/a.xml'));
    idx.addFile(uri('/r/res/drawable/b.xml'));
    fakeFiles['/r/res/drawable/a.xml'] = Buffer.from(VALID_VEC);
    fakeFiles['/r/res/drawable/b.xml'] = Buffer.from(VALID_VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = 'setIcon(if (s) R.drawable.a else R.drawable.b)';
    // Cursor in the second "b"
    const col = line.lastIndexOf('R.drawable.b') + 'R.drawable.'.length;
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect((h!.contents[0] as any).value).toContain('R.drawable.b');
  });

  it('does not leak regex lastIndex between hovers', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/x.xml'));
    fakeFiles['/r/res/drawable/x.xml'] = Buffer.from(VALID_VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val a = R.drawable.x';
    const col = line.indexOf('x');
    // Two calls in a row — the second must also find the token.
    const h1 = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    const h2 = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
  });

  it('treats R.raw.xxx as NOT a drawable (no false positives on other R.* namespaces)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/x.xml'));
    fakeFiles['/r/res/drawable/x.xml'] = Buffer.from(VALID_VEC);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val a = R.raw.x';
    const col = line.indexOf('x');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeUndefined();
  });

  it('truncates the preview for very large raster files', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/huge.png'));
    // 10 MB > MAX_EMBED_BYTES (256 KB) → preview must be skipped
    fakeFiles['/r/res/drawable/huge.png'] = new Uint8Array(10 * 1024 * 1024);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val a = R.drawable.huge';
    const col = line.indexOf('huge');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect(h).toBeDefined();
    const md = (h!.contents[0] as any).value as string;
    expect(md).toContain('R.drawable.huge');
    expect(md).not.toContain('data:image/png;base64,');
  });

  it('still embeds the preview when an XML is 10 MB (vector conversion is cheap)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/big.xml'));
    // Big but valid vector. Conversion emits much smaller SVG.
    const bigPath = 'M0,0' + 'L1,1'.repeat(200_000) + 'Z';
    const big = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="${bigPath}" android:fillColor="#000"/></vector>`;
    fakeFiles['/r/res/drawable/big.xml'] = Buffer.from(big);
    const provider = new DrawableHoverProvider(idx);
    const line = 'val a = R.drawable.big';
    const col = line.indexOf('big');
    const h = await provider.provideHover(doc(line), { line: 0, character: col } as any);
    expect((h!.contents[0] as any).value).toContain('data:image/svg+xml');
  });
});

// ── ADV-DGT — gutter provider under stress ────────────────────────────────────

describe('ADV-DGT — gutter provider under stress', () => {
  it('handles a file with many R.drawable references without exploding', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    fakeFiles['/r/res/drawable/ic.xml'] = Buffer.from(VALID_VEC);
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);

    const lines = Array(500).fill('val x = R.drawable.ic');
    const editor = mockEditor(lines);
    await flush(provider, editor);
    const total = editor.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    expect(total).toBe(500);
    // But the cache should contain exactly ONE file (same path).
    expect(fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'))).toHaveLength(1);
    provider.dispose();
  });

  it('does not crash when drawable XML is malformed (vector conversion fails)', async () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/bad.xml'));
    fakeFiles['/r/res/drawable/bad.xml'] = Buffer.from('<not-a-vector>garbage');
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    const editor = mockEditor(['val x = R.drawable.bad']);
    await flush(provider, editor);
    // No cache file was written (vectorXmlToSvg returned undefined).
    expect(fs.readdirSync(path.join(tmpDir, 'drawable-thumbs'))).toHaveLength(0);
    // No decoration was placed for this line.
    const total = editor.captures.reduce((n: number, c: any) => n + c.decorations.length, 0);
    expect(total).toBe(0);
    provider.dispose();
  });

  it('is safe to dispose twice', () => {
    const idx = new DrawableResourceIndex();
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    provider.dispose();
    expect(() => provider.dispose()).not.toThrow();
  });

  it('invalidatePath on an unknown URI is a safe no-op', () => {
    const idx = new DrawableResourceIndex();
    const provider = new DrawableGutterThumbnailProvider(idx, { fsPath: tmpDir } as any);
    expect(() => provider.invalidatePath({ path: '/nowhere' } as any)).not.toThrow();
    provider.dispose();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

const VALID_VEC = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:viewportWidth="24" android:viewportHeight="24"><path android:pathData="M0,0L1,1Z" android:fillColor="#FF0000"/></vector>`;

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
  (vscode as any).workspace.getConfiguration = () => ({ get: (_k: string, d: any) => d });
  provider.refreshAllEditors();
  await new Promise(r => setTimeout(r, 60));
}
