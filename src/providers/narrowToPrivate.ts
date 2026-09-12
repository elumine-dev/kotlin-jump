/**
 * KJ-049: where `private` goes on a declaration line.
 *
 * One place, because the per-member lightbulb and the bulk command must not
 * drift apart: the pair already existed as two copies of the same three lines,
 * and a copy is how a fix stops matching its own diagnostic.
 *
 * The visibility keyword is looked for in the LEADING MODIFIER RUN only. The
 * first version scanned the whole line, and `val label = "make it public "`
 * came back with the STRING rewritten and the member still not narrowed. A
 * comment did the same: `fun draw() { // make public later`. A refactor that
 * silently edits a literal is worse than one that does nothing.
 */
const VISIBILITY_RE = /\b(public|internal|protected)\s+/;

/** Modifiers and annotations Kotlin or Java may put before a declaration. */
const MODIFIER_RUN_RE = new RegExp(
  '^[\\t ]*(?:(?:@[\\w.]+(?:\\([^)]*\\))?|public|internal|protected|private|open|abstract'
  + '|final|sealed|data|enum|annotation|value|inline|noinline|crossinline|suspend|external'
  + '|expect|actual|operator|infix|tailrec|lateinit|const|override|companion|static'
  + '|synchronized|native|strictfp|transient|volatile|default)\\s+)*',
);

/**
 * Annotations only. `private` goes AFTER them: `@Inject private lateinit var x`
 * reads the way Kotlin is written, and putting it first would land the keyword
 * in front of an annotation.
 */
const ANNOTATION_RUN_RE = /^[\t ]*(?:@[\w.]+(?:\([^)]*\))?\s+)*/;

export interface PrivateEdit {
  /** Column where the edit starts. */
  column: number;
  /** Characters to replace, 0 for an insertion. */
  length: number;
  text: 'private ';
}

/** Undefined when the line is already private, or holds no declaration to narrow. */
export function narrowToPrivate(lineText: string): PrivateEdit | undefined {
  if (lineText.trim() === '') return undefined;
  const run = MODIFIER_RUN_RE.exec(lineText)?.[0] ?? '';
  if (/\bprivate\b/.test(run)) return undefined;
  const visibility = VISIBILITY_RE.exec(run);
  if (visibility) return { column: visibility.index, length: visibility[0].length, text: 'private ' };
  const afterAnnotations = ANNOTATION_RUN_RE.exec(lineText)?.[0].length ?? 0;
  return { column: afterAnnotations, length: 0, text: 'private ' };
}
