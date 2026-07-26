import { describe, it, expect } from 'vitest';
import { surroundSelection } from '../../../src/providers/SurroundWithProvider';

/** KJ-006 — tentatives de casse au-delà du contrat. */

describe('KJ-006 adversarial', () => {
  it('gabarit inconnu : sélection rendue telle quelle, pas de crash', () => {
    expect(surroundSelection('mystery', 'val x = 1', '')).toBe('val x = 1');
  });

  it('intra-line try/catch', () => {
    const out = surroundSelection('tryCatch', 'api.fetch()', '');
    expect(out).toContain('try {\n    api.fetch()');
    expect(out).toContain('catch (e: Exception)');
  });

  it('intra-line if: expression moved into the block, condition on $1', () => {
    const out = surroundSelection('if', 'launchBattle()', '    ');
    expect(out.startsWith('if ($1) {')).toBe(true);
    expect(out).toContain('    launchBattle()');
    expect(out.endsWith('\n}')).toBe(true);
  });

  it('relative offsets inside the selection are PRESERVED', () => {
    const sel = '        outer()\n    inner()';
    const out = surroundSelection('run', sel, '');
    const lines = out.split('\n');
    // The 4-space gap between the two lines survives re-indentation.
    const indentOf = (l: string) => l.length - l.trimStart().length;
    expect(indentOf(lines[1]) - indentOf(lines[2])).toBe(4);
  });

  it('lignes vides du bloc restent vides (pas d’espaces traînants)', () => {
    const out = surroundSelection('if', 'a()\n\nb()', '');
    expect(out.split('\n')[2]).toBe('');
  });

  it('sélection de lignes vides uniquement : pas de crash', () => {
    expect(() => surroundSelection('if', '   \n  ', '')).not.toThrow();
  });

  it('BUG-HUNT-20 : when sur une expression → la sélection devient le SUJET (Kotlin valide)', () => {
    // `when ($1) { pokemon }` était du Kotlin invalide (corps sans branche).
    // Sémantique IntelliJ : l'expression sélectionnée est le sujet du when.
    expect(surroundSelection('when', 'pokemon', '')).toBe('when (pokemon) {\n    $0\n}');
  });

  it('multi-line when closes at the relative level', () => {
    // Relative output: the closing brace sits at column 0 and VS Code adds
    // the insertion indentation when it inserts the snippet.
    const out = surroundSelection('when', 'is A -> 1\nis B -> 2', '  ');
    expect(out.endsWith('\n}')).toBe(true);
    expect(out).toContain('    is A -> 1');
  });
});
