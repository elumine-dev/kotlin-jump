/**
 * KJ-049: where `private` goes on a declaration line.
 *
 * One place, because the per-member lightbulb and the bulk command must not
 * drift apart: the pair already existed as two copies of the same three lines,
 * and a copy is how a fix stops matching its own diagnostic.
 */
const VISIBILITY_RE = /\b(public|internal|protected)\s+/;

export interface PrivateEdit {
  /** Column where the edit starts. */
  column: number;
  /** Characters to replace, 0 for an insertion. */
  length: number;
  text: 'private ';
}

/** Undefined when the line is already private, or holds no declaration to narrow. */
export function narrowToPrivate(lineText: string): PrivateEdit | undefined {
  if (/\bprivate\b/.test(lineText)) return undefined;
  if (lineText.trim() === '') return undefined;
  const visibility = VISIBILITY_RE.exec(lineText);
  if (visibility) return { column: visibility.index, length: visibility[0].length, text: 'private ' };
  const indent = /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
  return { column: indent, length: 0, text: 'private ' };
}
