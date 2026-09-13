import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';

/**
 * Where the `@Suppress("unused")` quick fix inserts its annotation.
 *
 * The cut and the annotation answer two different questions. A cut must
 * swallow the declaration's doc comment, or the file keeps a KDoc describing
 * nothing. The annotation must sit ON the declaration, under that KDoc: an
 * annotation above the doc comment pushes the comment inside the declaration,
 * where it is no longer the doc comment of anything.
 *
 * Four families answer the second question with the declaration's own line
 * (unused symbols, unused members, write only variables twice). This one
 * reused the cut's first line, so it answered above the KDoc whenever a cut
 * existed, and on the declaration whenever the extent was refused: the same
 * quick fix wrote the annotation in two places for the same shape.
 */
const ligneDe = (texte: string, motif: string): number =>
  texte.split('\n').findIndex(l => l.includes(motif));

describe('KJ-026 the suppress annotation sits on the declaration', () => {
  it('goes under the doc comment when the cut is available', () => {
    const texte = `class A {
    /** Ce que gone faisait. */
    private val gone = 1
    fun keep() = 2
}
`;
    const decl = findUnusedDeclarations(texte).find(d => d.name === 'gone');
    expect(decl).toBeDefined();
    expect(decl!.removeStart).toBeGreaterThanOrEqual(0);
    expect(decl!.suppressLine).toBe(ligneDe(texte, 'private val gone'));
  });

  it('goes to the same place when the extent is refused', () => {
    // Over eighty lines of expression: the extent walk gives up and the
    // Remove action is withheld, but Suppress is still offered.
    const longue = Array.from({ length: 100 }, (_, i) => `        "e${i}",`).join('\n');
    const texte = `class A {
    /** Ce que gone faisait. */
    private val gone = listOf(
${longue}
    )
    fun keep() = 2
}
`;
    const decl = findUnusedDeclarations(texte).find(d => d.name === 'gone');
    expect(decl).toBeDefined();
    expect(decl!.removeStart).toBe(-1);
    expect(decl!.suppressLine).toBe(ligneDe(texte, 'private val gone'));
  });

  it('still cuts the doc comment away with the declaration', () => {
    const texte = `class A {
    /** Ce que gone faisait. */
    private val gone = 1
    fun keep() = 2
}
`;
    const decl = findUnusedDeclarations(texte).find(d => d.name === 'gone');
    const coupe = texte.slice(decl!.removeStart, decl!.removeEnd);
    expect(coupe).toContain('Ce que gone faisait');
    expect(coupe).toContain('private val gone');
  });

  it('indents the annotation like the declaration', () => {
    const texte = `class A {
    /** Doc. */
    private val gone = 1
    fun keep() = 2
}
`;
    const decl = findUnusedDeclarations(texte).find(d => d.name === 'gone');
    expect(decl!.suppressIndent).toBe('    ');
  });
});
