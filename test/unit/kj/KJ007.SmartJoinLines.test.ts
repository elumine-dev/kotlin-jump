import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-007 — Smart join lines. CONTRAT :
 *   export function smartJoin(currentLine: string, nextLine: string):
 *     { joined: string; special: boolean }
 *   // special=false ⇒ fallback join standard (espace simple)
 */
const mod: any = await importOrNull('src/commands/smartJoinLines');

describe.skipIf(!mod)('KJ-007 — Smart join lines', () => {
  it('fusionne les littéraux concaténés', () => {
    const r = mod.smartJoin('val motto = "Gotta catch " +', '    "them all!"');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('val motto = "Gotta catch them all!"');
  });

  it('ne fusionne PAS les concat contenant une variable', () => {
    const r = mod.smartJoin('val s = "a" +', '    suffix');
    expect(r.special).toBe(false);
  });

  it('fusionne deux commentaires //', () => {
    const r = mod.smartJoin('// première moitié', '// seconde moitié');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('// première moitié seconde moitié');
  });

  it('joint une chaîne d’appels sans double espace', () => {
    const r = mod.smartJoin('    .filter { it > 0 }', '    .map { it * 2 }');
    expect(r.joined).toBe('    .filter { it > 0 }.map { it * 2 }');
  });

  it('string template préservée (pas de fusion hasardeuse)', () => {
    const r = mod.smartJoin('val s = "count: $n" +', '    "…"');
    expect(r.special).toBe(true);
    expect(r.joined).toBe('val s = "count: $n…"');
  });
});
