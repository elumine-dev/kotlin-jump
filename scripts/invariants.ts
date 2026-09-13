/**
 * Invariants shared by the witnesses, kept here so a unit test can hold them
 * to account. A witness that is wrong is worse than no witness: it reports
 * zero and the zero is believed.
 */

/** A cut that starts at a line start and ends at a line end. */
export function couvreDesLignesEntieres(texte: string, start: number, end: number): boolean {
  const debut = start === 0 || texte[start - 1] === '\n';
  const fin = end === texte.length || texte[end - 1] === '\n' || texte[end] === '\n';
  return debut && fin;
}

/**
 * A deletion is well formed when it takes WHOLE LINES, or when it stays
 * INSIDE one line. What it must never be is both: starting in the middle of a
 * line and running across a line boundary.
 *
 * This is a rule about the shape of the cut, and it took two wrong versions to
 * get there. The first named one detector family, `declarations`, and left 31
 * of the 52 deletions on the reference project held to nothing: shifting every
 * import cut by one character kept all seven counters at zero. The second held
 * every family to whole lines, which is worse in the other direction, because
 * the write only family deletes `var db = ` and `flag = ` on purpose and keeps
 * the call on the right for its side effect. Measured from the detector's own
 * output, not guessed: that version cried on two perfectly correct cuts, and
 * the reference project simply never took those code paths.
 *
 * The shape settles both. A prefix removal stays inside its line and passes. A
 * cut shifted by one character starts mid line and swallows a newline, so it
 * fails, whatever family produced it and with no list to keep up to date.
 *
 * Known limit: a shift applied to a cut that was already contained in one line
 * stays contained, so this rule cannot see it. Nothing else can either, and
 * saying so is better than pretending otherwise.
 */
export function coupeBienFormee(
  texte: string,
  start: number,
  end: number,
  remplacement: string,
): boolean {
  // A replacement is not a deletion: `{ footerIcon ->` becoming `{ _ ->` is
  // the Kotlin idiom for an unused lambda parameter, and it is mid line by
  // nature.
  if (remplacement !== '') return true;
  if (couvreDesLignesEntieres(texte, start, end)) return true;
  return !texte.slice(start, end).includes('\n');
}
