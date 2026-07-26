import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-006 — Surround with. CONTRAT :
 *   export const SURROUND_TEMPLATES: { id: string; label: string }[]
 *     // ids requis : if, tryCatch, let, run, apply, when
 *   export function surroundSelection(id: string, selection: string, baseIndent: string): string
 */
const mod: any = await importOrNull('src/providers/SurroundWithProvider');

describe.skipIf(!mod)('KJ-006 — Surround with', () => {
  it('les 6 gabarits sont exposés', () => {
    const ids = mod.SURROUND_TEMPLATES.map((t: any) => t.id);
    for (const id of ['if', 'tryCatch', 'let', 'run', 'apply', 'when']) {
      expect(ids, `gabarit manquant: ${id}`).toContain(id);
    }
  });

  it('try/catch re-indents the block one level, relative', () => {
    // Relative output: VS Code adds the insertion line's indentation when
    // it inserts the snippet. Emitting absolute indentation indented twice.
    const selection = 'val fetched = api.fetchPokemon(25)\nLog.d("KJ006", fetched)';
    const out = mod.surroundSelection('tryCatch', selection, '        ');
    expect(out).toContain('try {');
    expect(out).toContain('} catch (e: Exception) {');
    expect(out).toContain('    val fetched = api.fetchPokemon(25)');
    expect(out.split('\n').pop()).toBe('}');
  });

  it('restores the first line indentation dropped by getText(selection)', () => {
    // A selection starting after the indentation yields a first line with no
    // leading whitespace while the others keep theirs. Left alone, the block
    // came out staggered.
    const selection = 'val fetched = api.fetchPokemon(25)\n        Log.d("KJ006", fetched)';
    const out = mod.surroundSelection('tryCatch', selection, '        ');
    const body = out.split('\n').filter(l => l.includes('api.') || l.includes('Log.d'));
    expect(body[0].length - body[0].trimStart().length)
      .toBe(body[1].length - body[1].trimStart().length);
  });

  it('if entoure une sélection à indentation mixte sans la déchirer', () => {
    const selection = 'var total = 0\n        total += 1\n    total -= 1';
    const out = mod.surroundSelection('if', selection, '    ');
    const lines = out.split('\n');
    expect(lines[0].trim()).toMatch(/^if \(/);
    expect(lines[lines.length - 1].trim()).toBe('}');
  });

  it('let sur une sélection intra-ligne reste une expression', () => {
    const out = mod.surroundSelection('let', 'api.fetchPokemon(1)', '');
    expect(out).toBe('api.fetchPokemon(1).let { $0 }');
  });
});
