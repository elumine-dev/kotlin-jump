/**
 * KJD-DENS — exhaustive density + configuration qualifier coverage.
 *
 * Every Android qualifier that a real project might use against drawable/
 * and mipmap/ folders should:
 *   1. Be parsed as a variant of the same key
 *   2. Preserve the exact qualifier string (needed for the Variants list
 *      in the hover tooltip)
 *   3. Never shadow the default-density variant when one exists
 *
 * Reference: https://developer.android.com/guide/topics/resources/providing-resources
 */

import { describe, it, expect } from 'vitest';
import { DrawableResourceIndex } from '../../src/indexer/DrawableResourceIndex';

function uri(p: string) { return { path: p, toString: () => `file://${p}` }; }

// Every density bucket Android currently recognises.
const DENSITIES = [
  'ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi',
  'tvdpi', 'nodpi', 'anydpi', 'anydpi-v24',
];

describe('KJD-DENS — density buckets', () => {
  for (const d of DENSITIES) {
    it(`drawable-${d} registers as a distinct variant`, () => {
      const idx = new DrawableResourceIndex();
      idx.addFile(uri(`/r/res/drawable-${d}/ic.png`));
      expect(idx.get('ic')!.variants[0].qualifier).toBe(`drawable-${d}`);
    });

    it(`mipmap-${d} registers as a distinct variant`, () => {
      const idx = new DrawableResourceIndex();
      idx.addFile(uri(`/r/res/mipmap-${d}/ic_launcher.png`));
      expect(idx.get('ic_launcher')!.variants[0].qualifier).toBe(`mipmap-${d}`);
    });
  }

  it('all six main density buckets appear together under one key', () => {
    const idx = new DrawableResourceIndex();
    for (const d of ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      idx.addFile(uri(`/r/res/drawable-${d}/ic.png`));
    }
    expect(idx.get('ic')!.variants).toHaveLength(6);
  });
});

// ── KJD-DENS-CONFIG — configuration qualifiers ───────────────────────────────

const CONFIG_QUALIFIERS = [
  // Night mode / UI mode
  'night', 'notnight', 'night-v24',
  // Orientation
  'land', 'port',
  // Smallest width / available width / screen size
  'sw320dp', 'sw600dp', 'sw720dp',
  'w820dp', 'w1280dp',
  'h640dp', 'h1280dp',
  // Locale
  'en', 'fr', 'ja', 'es-rMX', 'zh-rCN',
  // RTL
  'ldltr', 'ldrtl',
  // API version
  'v21', 'v24', 'v29',
  // Combinations — this is where devs get creative
  'night-v29', 'land-xxhdpi', 'sw600dp-land', 'fr-night',
];

describe('KJD-DENS-CONFIG — configuration qualifiers', () => {
  for (const q of CONFIG_QUALIFIERS) {
    it(`drawable-${q} is recognised and preserved verbatim`, () => {
      const idx = new DrawableResourceIndex();
      idx.addFile(uri(`/r/res/drawable-${q}/asset.png`));
      const e = idx.get('asset');
      expect(e).toBeDefined();
      expect(e!.variants[0].qualifier).toBe(`drawable-${q}`);
    });
  }
});

// ── KJD-DENS-ORDER — sorting invariants ──────────────────────────────────────

describe('KJD-DENS-ORDER — sorting invariants', () => {
  it('default `drawable/` always sorts before any qualifier', () => {
    const idx = new DrawableResourceIndex();
    for (const q of ['drawable-xxxhdpi', 'drawable-night', 'drawable-ldpi', 'drawable']) {
      idx.addFile(uri(`/r/res/${q}/ic.png`));
    }
    expect(idx.get('ic')!.variants[0].qualifier).toBe('drawable');
  });

  it('default `mipmap/` always sorts before any qualifier', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/mipmap-xxxhdpi/ic_launcher.png'));
    idx.addFile(uri('/r/res/mipmap/ic_launcher.png'));
    expect(idx.get('ic_launcher')!.variants[0].qualifier).toBe('mipmap');
  });

  it('mixed drawable + mipmap variants for the same key preserve both', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic_shared.xml'));
    idx.addFile(uri('/r/res/mipmap-hdpi/ic_shared.png'));
    const qs = idx.get('ic_shared')!.variants.map(v => v.qualifier);
    expect(qs).toContain('drawable');
    expect(qs).toContain('mipmap-hdpi');
  });

  it('removing the default variant exposes the next qualifier as the head', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable/ic.xml'));
    idx.addFile(uri('/r/res/drawable-xxhdpi/ic.png'));
    idx.removeFile(uri('/r/res/drawable/ic.xml'));
    expect(idx.get('ic')!.variants[0].qualifier).toBe('drawable-xxhdpi');
  });
});

// ── KJD-DENS-DUPLICATES — duplicate qualifier handling ───────────────────────

describe('KJD-DENS-DUPLICATES — duplicate qualifier paths', () => {
  it('same key under same qualifier but different extensions → two variants', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/r/res/drawable-hdpi/ic.png'));
    idx.addFile(uri('/r/res/drawable-hdpi/ic.webp'));
    expect(idx.get('ic')!.variants).toHaveLength(2);
  });

  it('same key in different source trees (multi-module) stays collapsed by key', () => {
    const idx = new DrawableResourceIndex();
    idx.addFile(uri('/app/src/main/res/drawable/ic.xml'));
    idx.addFile(uri('/lib/src/main/res/drawable/ic.xml'));
    const e = idx.get('ic')!;
    expect(e.variants).toHaveLength(2);
    // Both should still sort with qualifier=drawable.
    for (const v of e.variants) expect(v.qualifier).toBe('drawable');
  });
});
