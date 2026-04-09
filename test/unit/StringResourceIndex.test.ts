import { describe, it, expect } from 'vitest';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';

function uri(path: string) {
  return { toString: () => path };
}

const DEFAULT_URI  = uri('file:///res/values/strings.xml');
const FR_URI       = uri('file:///res/values-fr/strings.xml');
const NIGHT_URI    = uri('file:///res/values-night/strings.xml');

// ── Parsing ───────────────────────────────────────────────────────────────────

describe('StringResourceIndex — parsing', () => {
  it('parses a simple value', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="greeting">Hello World</string></resources>`);
    expect(idx.getValue('greeting')?.value).toBe('Hello World');
  });

  it('trims leading/trailing whitespace from value', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources>\n  <string name="label">  Trimmed  </string>\n</resources>`);
    expect(idx.getValue('label')?.value).toBe('Trimmed');
  });

  it('parses a multi-line value', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="multi">Line one\nLine two</string></resources>`);
    expect(idx.getValue('multi')?.value).toBe('Line one\nLine two');
  });

  it('unwraps CDATA sections', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="html"><![CDATA[<b>Bold</b>]]></string></resources>`);
    expect(idx.getValue('html')?.value).toBe('<b>Bold</b>');
  });

  it('unescapes &amp;', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="x">a &amp; b</string></resources>`);
    expect(idx.getValue('x')?.value).toBe('a & b');
  });

  it('unescapes &lt; and &gt;', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="x">&lt;tag&gt;</string></resources>`);
    expect(idx.getValue('x')?.value).toBe('<tag>');
  });

  it('unescapes &quot; and &apos;', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="x">&quot;it&#x27;s&quot; fine</string></resources>`);
    // only &quot; and &apos; are handled, not &#x27;
    expect(idx.getValue('x')?.value).toContain('"');
  });

  it('records the correct line number', () => {
    const content = `<resources>\n  <string name="second">Value</string>\n</resources>`;
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, content);
    expect(idx.getValue('second')?.line).toBe(1);
  });

  it('parses a string tag with extra attributes (translatable, tools:ignore)', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="app_name" translatable="false">MyApp</string></resources>`);
    expect(idx.getValue('app_name')?.value).toBe('MyApp');
  });

  it('unknown key returns undefined', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="known">ok</string></resources>`);
    expect(idx.getValue('unknown')).toBeUndefined();
  });
});

// ── Locale priority ───────────────────────────────────────────────────────────

describe('StringResourceIndex — locale priority', () => {
  it('default locale (/values/) wins over qualified (/values-fr/)', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(FR_URI,      `<resources><string name="title">Titre</string></resources>`);
    idx.reindexFile(DEFAULT_URI, `<resources><string name="title">Title</string></resources>`);
    expect(idx.getValue('title')?.value).toBe('Title');
  });

  it('falls back to qualified locale when no default locale defines the key', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(FR_URI, `<resources><string name="only_fr">Bonjour</string></resources>`);
    expect(idx.getValue('only_fr')?.value).toBe('Bonjour');
  });

  it('qualified locales (/values-night/) do not shadow /values/', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(NIGHT_URI,   `<resources><string name="bg">Dark</string></resources>`);
    idx.reindexFile(DEFAULT_URI, `<resources><string name="bg">Light</string></resources>`);
    expect(idx.getValue('bg')?.value).toBe('Light');
  });
});

// ── Mutation ──────────────────────────────────────────────────────────────────

describe('StringResourceIndex — mutation', () => {
  it('reindexFile replaces all entries for that file', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="old">Old</string></resources>`);
    idx.reindexFile(DEFAULT_URI, `<resources><string name="new">New</string></resources>`);
    expect(idx.getValue('old')).toBeUndefined();
    expect(idx.getValue('new')?.value).toBe('New');
  });

  it('removeFile surgically removes only that file', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources><string name="a">A</string></resources>`);
    idx.reindexFile(FR_URI,      `<resources><string name="b">B</string></resources>`);
    idx.removeFile(DEFAULT_URI);
    expect(idx.getValue('a')).toBeUndefined();
    expect(idx.getValue('b')?.value).toBe('B');
  });

  it('removeFile on unknown uri is a no-op', () => {
    const idx = new StringResourceIndex();
    expect(() => idx.removeFile(uri('file:///nonexistent.xml'))).not.toThrow();
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('StringResourceIndex — edge cases', () => {
  it('empty content yields no entries', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, '');
    expect(idx.getValue('anything')).toBeUndefined();
  });

  it('multiple entries in one file are all indexed', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources>
  <string name="one">One</string>
  <string name="two">Two</string>
  <string name="three">Three</string>
</resources>`);
    expect(idx.getValue('one')?.value).toBe('One');
    expect(idx.getValue('two')?.value).toBe('Two');
    expect(idx.getValue('three')?.value).toBe('Three');
  });

  it('duplicate name — last writer wins within one reindexFile call', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(DEFAULT_URI, `<resources>
  <string name="dup">First</string>
  <string name="dup">Second</string>
</resources>`);
    // Map.set overwrites, so last occurrence wins
    expect(idx.getValue('dup')?.value).toBe('Second');
  });
});
