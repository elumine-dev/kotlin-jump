import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

/** KJ-010 — la grammaire ne peut pas être tokenisée en vitest ; on valide
 *  la règle elle-même : regex compilables, ancrage sur @Query uniquement.
 *
 *  Restructurée le 25/07 (bug Kevin : zéro couleur sur la forme
 *  multi-ligne). Un `begin` TextMate ne traverse pas les lignes : le bloc
 *  externe s'ouvre sur `@Query(` seul, et deux sous-blocs de strings
 *  (""" et ") portent les scopes SQL. */

const grammar = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'syntaxes', 'kotlin.tmLanguage.json'), 'utf8')
);
const rule = grammar.repository['kj-query-sql'];

const stringBlocks = () => rule.patterns.filter((p: any) => p.begin?.includes('"'));
const sqlPatternsOf = (block: any) =>
  block.patterns.find((p: any) => p.name?.includes('keyword.other.sql'));

describe('KJ-010 adversarial — règle kj-query-sql', () => {
  it('la règle existe et est branchée dans patterns', () => {
    expect(rule).toBeTruthy();
    expect(JSON.stringify(grammar.patterns)).toContain('kj-query-sql');
  });

  it('begin ne matche PAS une string SQL sans @Query', () => {
    const begin = new RegExp(rule.begin);
    expect(begin.test('val q = "SELECT * FROM x"')).toBe(false);
    expect(begin.test('@Query("SELECT * FROM x")')).toBe(true);
  });

  it('BUG (25/07) : @Query( seul sur sa ligne ouvre le bloc, la string vient après', () => {
    // La forme la plus courante en vrai code Room :
    //   @Query(
    //       """
    //       SELECT …
    const begin = new RegExp(rule.begin);
    expect(begin.test('@Query(')).toBe(true);
    expect(rule.end).toBe('\\)');
  });

  it('deux sous-blocs de strings portent le SQL : """ et "', () => {
    const blocks = stringBlocks();
    expect(blocks.map((b: any) => b.begin)).toEqual(['"""', '"']);
    for (const b of blocks) {
      expect(b.contentName).toContain('meta.embedded.inline.sql');
      expect(sqlPatternsOf(b)).toBeTruthy();
    }
  });

  it('le sous-bloc """ est déclaré AVANT " (sinon " matche la moitié du """)', () => {
    const begins = rule.patterns
      .map((p: any) => p.begin)
      .filter((b: string | undefined) => b?.includes('"'));
    expect(begins[0]).toBe('"""');
  });

  it('les keywords SQL sont case-insensitive et bornés', () => {
    for (const block of stringBlocks()) {
      const kw = sqlPatternsOf(block);
      const re = new RegExp(kw.match.replace('(?i)', ''), 'i');
      expect(re.test('select')).toBe(true);
      expect(re.test('SELECTED')).toBe(false); // frontière de mot
      expect(re.test('FROM')).toBe(true);
      expect(re.test('BY')).toBe(true);
    }
  });

  it(':param matche les paramètres Room mais pas les URLs', () => {
    for (const block of stringBlocks()) {
      const param = block.patterns.find((p: any) => p.name?.includes('variable.parameter'));
      const re = new RegExp(param.match, 'g');
      expect('WHERE id = :id AND lvl >= :minLevel'.match(re)).toEqual([':id', ':minLevel']);
      expect('https://pokeapi.co'.match(re)).toBeNull();
    }
  });

  it('toutes les regex de la règle compilent en JS', () => {
    expect(() => new RegExp(rule.begin)).not.toThrow();
    expect(() => new RegExp(rule.end)).not.toThrow();
    for (const block of stringBlocks()) {
      expect(() => new RegExp(block.begin)).not.toThrow();
      expect(() => new RegExp(block.end)).not.toThrow();
      for (const p of block.patterns) {
        expect(() => new RegExp(p.match.replace('(?i)', ''))).not.toThrow();
      }
    }
  });
});
