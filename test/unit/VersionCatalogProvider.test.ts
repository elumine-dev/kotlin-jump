/**
 * The scanner has its own tests; this one covers what they cannot reach, the
 * layer that talks to VS Code. Semantic tokens leave as a Uint32Array of delta
 * encoded quintuples, so a swapped argument, a legend index off by one or a
 * pair of tokens out of order all produce a well formed array that colours the
 * wrong thing. And a negative delta does not throw, it wraps to four billion.
 *
 * So the array is decoded back to absolute positions and compared against the
 * text it came from, on a fixture and on a catalog shaped like a real one.
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOG_LEGEND,
  VERSION_CATALOG_SELECTOR,
  VersionCatalogSemanticTokensProvider,
  VersionCatalogFoldingProvider,
} from '../../src/providers/VersionCatalogSyntaxProvider';
import { scanVersionCatalog, CATALOG_TOKEN_TYPES } from '../../src/providers/versionCatalogSyntax';

const NL = String.fromCharCode(10);

const CATALOGUE = [
  '[versions]',
  'kotlin = "2.3.20"',
  'guava = "33.5.0-android" # REDONDANT',
  '',
  '[libraries]',
  'core = { module = "androidx.core:core-ktx", version.ref = "kotlin" }',
  'graphics = { group = "androidx.compose.ui", name = "ui-graphics" }',
  '',
  '[bundles]',
  'common = [',
  '    "core",',
  ']',
  '',
  '[plugins]',
  'app = { id = "com.android.application", version.ref = "kotlin" }',
].join(NL);

function docFake(texte: string): any {
  return { getText: () => texte, uri: { toString: () => 'file:///gradle/libs.versions.toml' } };
}

/** Undoes the delta encoding VS Code expects, back to absolute positions. */
function decode(data: Uint32Array): Array<{ line: number; start: number; length: number; type: string }> {
  const out: Array<{ line: number; start: number; length: number; type: string }> = [];
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [dl, dc, len, type] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    line += dl;
    char = dl === 0 ? char + dc : dc;
    out.push({ line, start: char, length: len, type: CATALOG_LEGEND.tokenTypes[type] });
  }
  return out;
}

describe('version catalog semantic tokens reach VS Code intact', () => {
  const provider = new VersionCatalogSemanticTokensProvider();

  it('declares a legend that covers every type the scanner emits', () => {
    expect(CATALOG_LEGEND.tokenTypes).toEqual([...CATALOG_TOKEN_TYPES]);
    expect(CATALOG_LEGEND.tokenModifiers).toEqual([]);
  });

  it('round trips: what is decoded is what the scanner produced', () => {
    const tokens = provider.provideDocumentSemanticTokens(docFake(CATALOGUE) as any);
    const decode2 = decode(tokens.data);
    const attendus = scanVersionCatalog(CATALOGUE).tokens
      .map(t => ({ line: t.line, start: t.start, length: t.length, type: t.type as string }));
    expect(decode2).toEqual(attendus);
    expect(decode2.length).toBeGreaterThan(20);
  });

  it('every decoded token quotes the text it claims', () => {
    const lignes = CATALOGUE.split(NL);
    for (const t of decode(provider.provideDocumentSemanticTokens(docFake(CATALOGUE) as any).data)) {
      const extrait = lignes[t.line].slice(t.start, t.start + t.length);
      expect(extrait.length, `L${t.line} ${t.type}`).toBe(t.length);
      if (t.type === 'namespace') expect(extrait.startsWith('[')).toBe(true);
      if (t.type === 'comment')   expect(extrait.startsWith('#')).toBe(true);
      if (t.type === 'number' || t.type === 'string' || t.type === 'enumMember') {
        expect(extrait[0], `L${t.line} ${extrait}`).toMatch(/["']/);
      }
    }
  });

  it('never encodes a negative delta, which Uint32Array would turn into four billion', () => {
    const data = provider.provideDocumentSemanticTokens(docFake(CATALOGUE) as any).data;
    for (let i = 0; i < data.length; i += 5) {
      // A line or column delta above this bound can only come from a wrap.
      expect(data[i],     `deltaLine a l offset ${i}`).toBeLessThan(1_000_000);
      expect(data[i + 1], `deltaStart a l offset ${i}`).toBeLessThan(1_000_000);
      expect(data[i + 2], `longueur a l offset ${i}`).toBeGreaterThan(0);
      expect(data[i + 3], `type a l offset ${i}`).toBeLessThan(CATALOG_LEGEND.tokenTypes.length);
    }
  });

  it('gives an empty array rather than throwing on an empty document', () => {
    expect(provider.provideDocumentSemanticTokens(docFake('') as any).data.length).toBe(0);
  });
});

describe('version catalog folding reaches VS Code intact', () => {
  const provider = new VersionCatalogFoldingProvider();

  it('turns every region into a FoldingRange the editor accepts', () => {
    const plis = provider.provideFoldingRanges(docFake(CATALOGUE) as any);
    const lignes = CATALOGUE.split(NL);
    expect(plis.length).toBe(scanVersionCatalog(CATALOGUE).regions.length);
    for (const p of plis) {
      expect(p.end, JSON.stringify(p)).toBeGreaterThan(p.start);
      expect(p.end).toBeLessThan(lignes.length);
      expect(p.kind).toBe(3); // FoldingRangeKind.Region
    }
    // The four tables collapse, and the array inside [bundles] on its own.
    expect(plis.map(p => [p.start, p.end])).toEqual([[0, 2], [4, 6], [8, 11], [9, 11], [13, 14]]);
  });

  it('gives no range rather than throwing on an empty document', () => {
    expect(provider.provideFoldingRanges(docFake('') as any)).toEqual([]);
  });
});

describe('version catalog selector', () => {
  it('claims catalogs by file name and nothing else', () => {
    expect(VERSION_CATALOG_SELECTOR).toEqual([{ pattern: '**/*.versions.toml' }]);
  });
});
