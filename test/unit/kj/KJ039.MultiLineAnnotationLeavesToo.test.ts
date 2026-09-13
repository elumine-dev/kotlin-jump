import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Une annotation etalee sur plusieurs lignes part avec son entree.
 *
 * La remontee testait chaque ligne du dessus prise ISOLEMENT. Une annotation
 * multiligne ne passe pas ce test : la ligne juste au dessus de l entree est
 * `)`, qui n est pas une annotation, et la remontee s arretait la.
 *
 * Ce que le correctif d origine voulait empecher se produisait donc encore,
 * sous sa forme multiligne : l annotation se rattache a l entree suivante, qui
 * est vivante. Et quand l entree morte est la DERNIERE, il ne reste plus rien
 * apres l annotation qu une accolade fermante, et le fichier cesse de parser.
 */
const analyse = (texte: string) =>
  findUnusedEnumEntries({
    sources: [{ path: '/w/E.kt', text: texte }] as any,
    testSourceSets: [],
  }).find(x => x.name === 'MORT');

const apres = (texte: string, e: { removeStart: number; removeEnd: number }) =>
  texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);

describe('KJ-039 annotation multiligne', () => {
  const MILIEU = `package p
enum class E {
    @Suppress(
        "x",
    )
    MORT,
    VIVANT
}
fun f() = E.VIVANT
`;

  it('part avec l entree, au lieu de se rattacher a la suivante', () => {
    const e = analyse(MILIEU)!;
    expect(e).toBeDefined();
    expect(MILIEU.slice(e.removeStart, e.removeEnd)).toContain('@Suppress(');
    expect(apres(MILIEU, e)).not.toContain('@Suppress');
  });

  it('ne laisse pas une annotation collee a l accolade fermante', () => {
    const DERNIERE = `package p
enum class E {
    VIVANT,
    @Suppress(
        "x",
    )
    MORT,
}
fun f() = E.VIVANT
`;
    const e = analyse(DERNIERE)!;
    expect(e).toBeDefined();
    // Ce qui reste ne doit pas finir sur une annotation orpheline.
    expect(apres(DERNIERE, e)).not.toContain('@Suppress');
    expect(apres(DERNIERE, e)).toContain('VIVANT,');
  });

  it('temoin : une annotation sur une seule ligne partait deja', () => {
    const SIMPLE = `package p
enum class E {
    @Deprecated("x")
    MORT,
    VIVANT
}
fun f() = E.VIVANT
`;
    const e = analyse(SIMPLE)!;
    expect(apres(SIMPLE, e)).not.toContain('@Deprecated');
  });

  it('temoin : sur la meme ligne, la remontee ne franchit pas la virgule', () => {
    const MEME_LIGNE = `package p
enum class E {
    VIVANT, @Deprecated("x") MORT
}
fun f() = E.VIVANT
`;
    const e = analyse(MEME_LIGNE);
    if (e) expect(MEME_LIGNE.slice(e.removeStart, e.removeEnd)).not.toContain('VIVANT');
  });

  it('temoin : une ligne vide coupe toujours la remontee', () => {
    const AVEC_VIDE = `package p
enum class E {
    @Deprecated("x")

    MORT,
    VIVANT
}
fun f() = E.VIVANT
`;
    const e = analyse(AVEC_VIDE)!;
    expect(AVEC_VIDE.slice(e.removeStart, e.removeEnd)).not.toContain('@Deprecated');
  });
});
