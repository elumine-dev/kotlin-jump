/**
 * `gradle/libs.versions.toml` opens as plain text in VS Code, which ships no
 * TOML grammar: one colour for the whole file, and nothing to collapse because
 * the fallback folding needs indentation. The scanner behind the two providers
 * gives both, and knows what a generic grammar could not: the string after
 * `version.ref` points at a key of the `[versions]` table.
 *
 * Checked against the real catalog of a 5088 file project, 293 lines, 1128
 * tokens, no overflow, no overlap, three foldable tables.
 */
import { describe, it, expect } from 'vitest';
import { scanVersionCatalog, type CatalogToken } from '../../src/providers/versionCatalogSyntax';
import { expectFasterThan } from './perfBudget';

const NL = String.fromCharCode(10);

const CATALOGUE = [
  '[versions]',
  'aboutlibraries = "13.2.1"',
  'guava = "33.5.0-android"',
  'androidJunit5 = "2.0.1" # REDONDANT, kotlin-test suffit',
  '#noinspection GradleDependency: Robolectric casse plus haut',
  'androidxRoomReplica = "2.4.2"',
  '',
  '[libraries]',
  'aboutlibraries-core = { module = "com.mikepenz:aboutlibraries-core", version.ref = "aboutlibraries" }',
  'firebase-analytics = { module = "com.google.firebase:firebase-analytics" }',
  'compose-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }',
  'doc = { module = "org.x:y", url = "https://example.org/a#anchor" }',
  '',
  '[bundles]',
  'common = [',
  '    "aboutlibraries-core",',
  '    "firebase-analytics",',
  ']',
  '',
  '[plugins]',
  'android-application = { id = "com.android.application", version.ref = "androidGradlePlugin" }',
].join(NL);

function at(tokens: CatalogToken[], ligne: number): Array<[string, string]> {
  const source = CATALOGUE.split(NL)[ligne];
  return tokens.filter(t => t.line === ligne).map(t => [t.type, source.slice(t.start, t.start + t.length)]);
}

describe('version catalog colouring', () => {
  const { tokens } = scanVersionCatalog(CATALOGUE);

  it('separates the table header from the alias and the version literal', () => {
    expect(at(tokens, 0)).toEqual([['namespace', '[versions]']]);
    expect(at(tokens, 1)).toEqual([['property', 'aboutlibraries'], ['number', '"13.2.1"']]);
    // A qualifier after the digits is still a version, not a coordinate.
    expect(at(tokens, 2)).toEqual([['property', 'guava'], ['number', '"33.5.0-android"']]);
  });

  it('reads a version.ref as a reference, and a coordinate as a plain string', () => {
    expect(at(tokens, 8)).toEqual([
      ['property',   'aboutlibraries-core'],
      ['parameter',  'module'],
      ['string',     '"com.mikepenz:aboutlibraries-core"'],
      ['parameter',  'version.ref'],
      ['enumMember', '"aboutlibraries"'],
    ]);
  });

  it('handles an entry with no version, and the group/name pair', () => {
    expect(at(tokens, 9)).toEqual([
      ['property', 'firebase-analytics'], ['parameter', 'module'],
      ['string', '"com.google.firebase:firebase-analytics"'],
    ]);
    expect(at(tokens, 10)).toEqual([
      ['property', 'compose-graphics'],
      ['parameter', 'group'], ['string', '"androidx.compose.ui"'],
      ['parameter', 'name'],  ['string', '"ui-graphics"'],
    ]);
  });

  it('does not cut a value on a # that belongs to it', () => {
    // The fragment of an URL is not the start of a comment.
    expect(at(tokens, 11)).toEqual([
      ['property', 'doc'],
      ['parameter', 'module'], ['string', '"org.x:y"'],
      ['parameter', 'url'],    ['string', '"https://example.org/a#anchor"'],
    ]);
  });

  it('takes the whole trailing comment, and a #noinspection line', () => {
    expect(at(tokens, 3)).toEqual([
      ['property', 'androidJunit5'], ['number', '"2.0.1"'],
      ['comment', '# REDONDANT, kotlin-test suffit'],
    ]);
    expect(at(tokens, 4)).toEqual([['comment', '#noinspection GradleDependency: Robolectric casse plus haut']]);
  });

  it('keeps every array element on the same footing across the lines', () => {
    expect(at(tokens, 14)).toEqual([['property', 'common']]);
    expect(at(tokens, 15)).toEqual([['string', '"aboutlibraries-core"']]);
    expect(at(tokens, 16)).toEqual([['string', '"firebase-analytics"']]);
  });

  it('emits tokens in order, inside their line, without overlap', () => {
    const lignes = CATALOGUE.split(NL);
    let precedent: CatalogToken | undefined;
    const finDeLigne = new Map<number, number>();
    expect(tokens.length, 'sans jeton, l ordre ne prouve rien').toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t.start, `ligne ${t.line}`).toBeGreaterThanOrEqual(0);
      expect(t.start + t.length, `ligne ${t.line}`).toBeLessThanOrEqual(lignes[t.line].length);
      expect(finDeLigne.get(t.line) ?? 0, `chevauchement ligne ${t.line}`).toBeLessThanOrEqual(t.start);
      finDeLigne.set(t.line, t.start + t.length);
      if (precedent) {
        const avance = t.line > precedent.line || (t.line === precedent.line && t.start >= precedent.start);
        expect(avance, `ordre rompu ligne ${t.line}`).toBe(true);
      }
      precedent = t;
    }
  });
});

describe('version catalog folding', () => {
  const { regions } = scanVersionCatalog(CATALOGUE);

  it('folds each table down to its last non blank line', () => {
    expect(regions).toContainEqual({ start: 0, end: 5 });    // [versions]
    expect(regions).toContainEqual({ start: 7, end: 11 });   // [libraries]
    expect(regions).toContainEqual({ start: 13, end: 17 });  // [bundles]
    expect(regions).toContainEqual({ start: 19, end: 20 });  // [plugins]
  });

  it('folds a multi line array on its own', () => {
    expect(regions).toContainEqual({ start: 14, end: 17 });
  });

  it('never emits a region of a single line or past the end', () => {
    const total = CATALOGUE.split(NL).length;
    expect(regions.length, 'sans region, la borne ne prouve rien').toBeGreaterThan(0);
    for (const r of regions) {
      expect(r.end, JSON.stringify(r)).toBeGreaterThan(r.start);
      expect(r.end, JSON.stringify(r)).toBeLessThan(total);
    }
  });

  it('does not let an unclosed bracket swallow the tables below it', () => {
    const casse = ['[versions]', 'a = [', '', '[libraries]', 'b = { module = "x:y" }'].join(NL);
    const { tokens: t2, regions: r2 } = scanVersionCatalog(casse);
    // `b` is an alias again, not an inline table key inherited from line 1.
    expect(t2.find(x => x.line === 4 && x.length === 1)?.type).toBe('property');
    for (const r of r2) expect(r.end).toBeLessThan(5);
  });
});

describe('version catalog scan cost', () => {
  it('stays well under a keystroke on a catalog far larger than a real one', () => {
    const gros = Array.from({ length: 40 }, () => CATALOGUE).join(NL); // ~840 lignes
    expectFasterThan(50, () => { for (let i = 0; i < 10; i++) scanVersionCatalog(gros); });
  });
});
