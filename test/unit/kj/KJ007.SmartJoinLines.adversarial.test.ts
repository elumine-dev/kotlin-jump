import { describe, it, expect } from 'vitest';
import { smartJoin } from '../../../src/commands/smartJoinLines';

/** KJ-007 — tentatives de casse au-delà du contrat. */

describe('KJ-007 adversarial', () => {
  it('`+` À L’INTÉRIEUR d’un littéral ne déclenche pas la fusion', () => {
    const r = smartJoin('val s = "a + b"', 'val t = 2');
    expect(r.special).toBe(false);
    expect(r.joined).toBe('val s = "a + b" val t = 2');
  });

  it('chaîne safe-call ?. collée sans espace', () => {
    const r = smartJoin('    user', '        ?.name');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('    user?.name');
  });

  it('espaces multiples autour du + tolérés', () => {
    const r = smartJoin('val s = "a"   +   ', '  "b"');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('val s = "ab"');
  });

  it('ligne suivante vide : trim simple, pas de crash', () => {
    const r = smartJoin('val x = 1', '');
    expect(r.joined).toBe('val x = 1');
  });

  it('commentaire /// KDoc-like traité comme //', () => {
    const r = smartJoin('// alpha', '/// beta');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('// alpha / beta');
  });

  it('concat où la ligne suivante n’est PAS un littéral : fallback', () => {
    const r = smartJoin('val s = "a" +', '    b.toString()');
    expect(r.special).toBe(false);
    expect(r.joined).toBe('val s = "a" + b.toString()');
  });
});
