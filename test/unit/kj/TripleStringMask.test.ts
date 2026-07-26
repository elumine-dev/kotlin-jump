import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Masque des strings triple-quoted (KJ-010, bug du 25/07) : les mots-clés
 * SQL d'un @Query(""" … """) recevaient des tokens sémantiques qui
 * écrasaient la grammaire embarquée (FROM/BY blancs au lieu de bleus).
 * CONTRAT :
 *   export function computeTripleStringMask(lines: string[]): Map<number, [number, number][]>
 *   export function inTripleStringMask(mask, line, col): boolean
 */
const mod: any = await importOrNull('src/providers/SemanticTokensProvider');

describe.skipIf(!mod)('Triple-quoted string mask', () => {
  const SQL = [
    '@Query(',                              // 0
    '    value = """',                      // 1
    '    SELECT p.name FROM pokemon AS p',  // 2
    '    GROUP BY p.name',                  // 3
    '""")',                                 // 4
    'fun findAll(): List<String>',          // 5
  ];

  it('les lignes intérieures du bloc sont masquées', () => {
    const mask = mod.computeTripleStringMask(SQL);
    expect(mod.inTripleStringMask(mask, 2, 18)).toBe(true);  // FROM
    expect(mod.inTripleStringMask(mask, 3, 10)).toBe(true);  // BY
  });

  it('le code hors bloc reste tokenisable', () => {
    const mask = mod.computeTripleStringMask(SQL);
    expect(mod.inTripleStringMask(mask, 0, 1)).toBe(false);  // @Query
    expect(mod.inTripleStringMask(mask, 5, 4)).toBe(false);  // findAll
  });

  it('bloc ouvert et fermé sur la même ligne', () => {
    const mask = mod.computeTripleStringMask(['val a = """x FROM y""" + b']);
    expect(mod.inTripleStringMask(mask, 0, 14)).toBe(true);   // FROM dans la string
    expect(mod.inTripleStringMask(mask, 0, 24)).toBe(false);  // b hors string
  });

  it('deux blocs successifs ne fuient pas l\'un dans l\'autre', () => {
    const lines = ['val a = """one"""', 'val between = 1', 'val b = """two"""'];
    const mask = mod.computeTripleStringMask(lines);
    expect(mod.inTripleStringMask(mask, 1, 4)).toBe(false);
  });

  it('document sans triple quote : masque vide', () => {
    expect(mod.computeTripleStringMask(['val x = "simple"']).size).toBe(0);
  });
});
