import { describe, it, expect } from 'vitest';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';

function uri(path: string) { return { toString: () => path }; }

const DEFAULT = uri('file:///res/values/strings.xml');
const FR      = uri('file:///res/values-fr/strings.xml');
const EN      = uri('file:///res/values-en/strings.xml');

// ── getLocaleEntries ──────────────────────────────────────────────────────────

describe('StringResourceIndex — getLocaleEntries', () => {
  it('returns entries for each locale that defines the key', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="title">Title</string></resources>`);
    idx.reindexFile(FR,      `<resources><string name="title">Titre</string></resources>`);
    const locales = idx.getLocaleEntries('title');
    expect(locales.size).toBe(2);
    expect(locales.get('values')?.value).toBe('Title');
    expect(locales.get('values-fr')?.value).toBe('Titre');
  });

  it('returns empty map for an unknown key', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="known">K</string></resources>`);
    expect(idx.getLocaleEntries('missing').size).toBe(0);
  });

  it('returns only the locales that define the key — absent locales are excluded', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="only_default">X</string></resources>`);
    idx.reindexFile(EN,      `<resources><string name="other">Y</string></resources>`);
    const locales = idx.getLocaleEntries('only_default');
    expect(locales.has('values')).toBe(true);
    expect(locales.has('values-en')).toBe(false);
  });

  it('uses the locale qualifier as map key (values → "values", values-fr → "values-fr")', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="k">A</string></resources>`);
    idx.reindexFile(FR,      `<resources><string name="k">B</string></resources>`);
    const locales = idx.getLocaleEntries('k');
    expect([...locales.keys()].sort()).toEqual(['values', 'values-fr']);
  });

  it('updates after removeFile — removed locale no longer appears', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="x">A</string></resources>`);
    idx.reindexFile(EN,      `<resources><string name="x">B</string></resources>`);
    idx.removeFile(EN);
    const locales = idx.getLocaleEntries('x');
    expect(locales.has('values-en')).toBe(false);
    expect(locales.has('values')).toBe(true);
  });
});

// ── getKnownLocales ───────────────────────────────────────────────────────────

describe('StringResourceIndex — getKnownLocales', () => {
  it('returns sorted locale qualifiers indexed so far', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(FR,      `<resources><string name="a">A</string></resources>`);
    idx.reindexFile(DEFAULT, `<resources><string name="b">B</string></resources>`);
    idx.reindexFile(EN,      `<resources><string name="c">C</string></resources>`);
    expect(idx.getKnownLocales()).toEqual(['values', 'values-en', 'values-fr']);
  });

  it('returns empty array when nothing has been indexed', () => {
    const idx = new StringResourceIndex();
    expect(idx.getKnownLocales()).toEqual([]);
  });

  it('removes locale from known set after removeFile on last file for that locale', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string name="a">A</string></resources>`);
    idx.reindexFile(EN,      `<resources><string name="b">B</string></resources>`);
    idx.removeFile(EN);
    expect(idx.getKnownLocales()).toEqual(['values']);
  });
});

// ── plurals value capture ─────────────────────────────────────────────────────

describe('StringResourceIndex — plurals value capture', () => {
  it('captures the "other" quantity as the plural value', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources>
  <plurals name="count">
    <item quantity="one">%d item</item>
    <item quantity="other">%d items</item>
  </plurals>
</resources>`);
    expect(idx.getPluralsValue('count')?.value).toBe('%d items');
  });

  it('falls back to next-priority quantity when "other" is missing', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources>
  <plurals name="count">
    <item quantity="one">one only</item>
  </plurals>
</resources>`);
    const entry = idx.getPluralsValue('count');
    expect(entry?.value).toBe('one only');
    expect(entry?.chosenQuantity).toBe('one');
  });
});

// ── string-array value capture ────────────────────────────────────────────────

describe('StringResourceIndex — array value capture', () => {
  it('captures all items as a bracketed list', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources>
  <string-array name="types">
    <item>Fire</item>
    <item>Water</item>
    <item>Grass</item>
  </string-array>
</resources>`);
    expect(idx.getArrayValue('types')?.value).toBe('[Fire, Water, Grass]');
  });

  it('returns empty string for an empty string-array', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources><string-array name="empty"></string-array></resources>`);
    expect(idx.getArrayValue('empty')?.value).toBe('');
  });

  it('unescapes XML entities inside array items', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT, `<resources>
  <string-array name="ops">
    <item>A &amp; B</item>
    <item>&lt;C&gt;</item>
  </string-array>
</resources>`);
    expect(idx.getArrayValue('ops')?.value).toBe('[A & B, <C>]');
  });
});
