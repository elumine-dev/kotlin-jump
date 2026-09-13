/**
 * Invariants shared by the witnesses, kept here so a unit test can hold them
 * to account. A witness that is wrong is worse than no witness: it reports
 * zero and the zero is believed.
 */

/**
 * Families whose deletions are NOT whole lines, by design.
 *
 * `locals` removes the assignment prefix alone, `var db = `, and keeps the
 * call on the right for its side effect. That is correct behaviour and an
 * oracle must never cry about correct behaviour.
 *
 * This exemption used to be written against `writeOnly`, which does not do
 * that at all, and the rule was then narrowed to `declarations` alone.
 * Measured on the reference project: declarations 19 deletions and 19 whole
 * lines, writeOnly 11 and 11, imports 20 and 20, locals 2 and 0. So 31
 * deletions that do take whole lines were checked by nothing, and a one
 * character shift applied to the import cuts left all seven counters at zero.
 */
export const FAMILLES_A_COUPE_PARTIELLE = new Set(['locals']);

/** A cut that starts at a line start and ends at a line end. */
export function couvreDesLignesEntieres(texte: string, start: number, end: number): boolean {
  const debut = start === 0 || texte[start - 1] === '\n';
  const fin = end === texte.length || texte[end - 1] === '\n' || texte[end] === '\n';
  return debut && fin;
}

/**
 * Whether this edit is held to the whole line rule.
 *
 * An unknown family is held to it. An oracle that stays quiet about what it
 * does not recognise is the failure this whole file exists to prevent: a new
 * detector would arrive unchecked and nothing would say so.
 */
export function doitCouperDesLignesEntieres(remplacement: string, famille: string | undefined): boolean {
  return remplacement === '' && !FAMILLES_A_COUPE_PARTIELLE.has(famille ?? '');
}
