/**
 * DrawableResourceIndex — scan path → key mapping across qualifier folders.
 *
 * Attack surface:
 *  1. PATH_RE — res/drawable | res/mipmap with/without qualifiers
 *  2. Variant ordering (default density first, then alphabetical)
 *  3. Idempotent re-add (onDidChange path must not duplicate entries)
 *  4. removeFile leaving a clean empty-key state
 */

import { describe, it, expect } from 'vitest';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';

function uri(p: string) {
  return { path: p, toString: () => `file://${p}` };
}

// ── KJD-DRI-1 — path parsing ──────────────────────────────────────────────────

describe('KJD-DRI-1 — path parsing', () => {
  it('indexes drawable default-density', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/src/main/res/drawable/ic_pokeball.xml'));
    const e = idx.get('ic_pokeball');
    expect(e).toBeDefined();
    expect(e!.variants).toHaveLength(1);
    expect(e!.variants[0].qualifier).toBe('drawable');
    expect(e!.variants[0].ext).toBe('xml');
  });

  it('indexes mipmap launcher', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/src/main/res/mipmap-xhdpi/ic_launcher.png'));
    expect(idx.get('ic_launcher')!.variants[0].qualifier).toBe('mipmap-xhdpi');
  });

  it('accepts every supported extension', () => {
    const idx = new DrawableResourceIndex();
    for (const ext of ['xml', 'png', 'webp', 'svg', 'jpg', 'jpeg', 'gif', 'bmp']) {
      idx.addFile(uri(`/r/res/drawable/k.${ext}`));
      expect(idx.get('k')!.variants.some(v => v.ext === ext)).toBe(true);
      idx.removeFile(uri(`/r/res/drawable/k.${ext}`));
    }
  });

  it('9-patch (.9.png) registers under bare key with isNinePatch flag', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/btn_primary.9.png'));
    const e = idx.get('btn_primary');
    expect(e).toBeDefined();
    expect(e!.variants[0].isNinePatch).toBe(true);
    expect(e!.variants[0].ext).toBe('png');
    // No leak under the ".9" pseudo-key
    expect(idx.get('btn_primary.9')).toBeUndefined();
  });

  it('normal PNG has isNinePatch=false', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/plain.png'));
    expect(idx.get('plain')!.variants[0].isNinePatch).toBe(false);
  });

  it('case-insensitive file extensions', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.PNG'));
    idx.addFile(uri('/r/res/drawable/iv.JPEG'));
    expect(idx.get('ic')!.variants[0].ext).toBe('png');
    expect(idx.get('iv')!.variants[0].ext).toBe('jpeg');
  });

  it('rejects paths not under res/drawable* or res/mipmap*', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/src/main/res/values/strings.xml'));
    idx.addFile(uri('/app/src/main/res/layout/main.xml'));
    idx.addFile(uri('/some/random/file.png'));
    expect(idx.size()).toBe(0);
  });

  it('rejects unsupported extensions in drawable folder', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/.DS_Store'));
    idx.addFile(uri('/r/res/drawable/readme.txt'));
    idx.addFile(uri('/r/res/drawable/cache.9.patch'));
    expect(idx.size()).toBe(0);
  });
});

// ── KJD-DRI-2 — multi-variant aggregation ─────────────────────────────────────

describe('KJD-DRI-2 — multi-variant aggregation', () => {
  it('gathers multiple density variants for same key', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable-mdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable-hdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable-xxhdpi/ic.png'));
    expect(idx.get('ic')!.variants).toHaveLength(3);
  });

  it('default-density variant sorts first', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable-xxhdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable/ic.png'));
    idx.addFile(uri('/r/res/drawable-hdpi/ic.png'));
    const qs = idx.get('ic')!.variants.map(v => v.qualifier);
    expect(qs[0]).toBe('drawable');
    expect(qs.slice(1)).toEqual(['drawable-hdpi', 'drawable-xxhdpi']);
  });

  it('non-default qualifiers sort alphabetically when no default present', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable-xxhdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable-hdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable-mdpi/ic.png'));
    const qs = idx.get('ic')!.variants.map(v => v.qualifier);
    expect(qs).toEqual(['drawable-hdpi', 'drawable-mdpi', 'drawable-xxhdpi']);
  });

  it('different keys do not cross-contaminate', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/a.xml'));
    idx.addFile(uri('/r/res/drawable/b.xml'));
    expect(idx.get('a')!.variants).toHaveLength(1);
    expect(idx.get('b')!.variants).toHaveLength(1);
  });
});

// ── KJD-DRI-3 — idempotent re-add and removal ────────────────────────────────

describe('KJD-DRI-3 — idempotent re-add and removal', () => {
  it('re-adding same file does not duplicate variants', () => {
    const idx = new DrawableResourceIndex();
    const u = uri('/r/res/drawable/ic.xml');
    idx.addFile(u);
    idx.addFile(u);
    idx.addFile(u);
    expect(idx.get('ic')!.variants).toHaveLength(1);
  });

  it('removeFile cleans exactly one variant', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    idx.addFile(uri('/r/res/drawable-hdpi/ic.png'));
    idx.removeFile(uri('/r/res/drawable/ic.xml'));
    const e = idx.get('ic')!;
    expect(e.variants).toHaveLength(1);
    expect(e.variants[0].qualifier).toBe('drawable-hdpi');
  });

  it('removing last variant drops the key entirely', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/lonely.xml'));
    idx.removeFile(uri('/r/res/drawable/lonely.xml'));
    expect(idx.get('lonely')).toBeUndefined();
    expect(idx.has('lonely')).toBe(false);
    expect(idx.size()).toBe(0);
  });

  it('removeFile on an unknown path is a no-op', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    idx.removeFile(uri('/r/res/drawable/never-added.xml'));
    expect(idx.get('ic')).toBeDefined();
  });
});

// ── KJD-DRI-4 — lookup semantics ──────────────────────────────────────────────

describe('KJD-DRI-4 — lookup semantics', () => {
  it('get(unknown) returns undefined', () => {
    const idx = new DrawableResourceIndex();
    expect(idx.get('nope')).toBeUndefined();
  });

  it('has() agrees with get()', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/a.xml'));
    expect(idx.has('a')).toBe(true);
    expect(idx.has('b')).toBe(false);
  });

  it('size() counts unique keys, not variants', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/a.xml'));
    idx.addFile(uri('/r/res/drawable-hdpi/a.png'));
    idx.addFile(uri('/r/res/drawable/b.xml'));
    expect(idx.size()).toBe(2);
  });
});
