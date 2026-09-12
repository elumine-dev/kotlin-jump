/**
 * KJ-049: where `private` goes on a declaration line.
 *
 * One place, because the per-member lightbulb and the bulk command must not
 * drift apart: the pair already existed as two copies of the same three lines,
 * and a copy is how a fix stops matching its own diagnostic.
 *
 * The visibility keyword is read from the MODIFIERS ONLY, never from the whole
 * line and never from an annotation's arguments. Both wider readings were
 * shipped and both rewrote source they had no business touching:
 *   `val label = "make it public "`      became `"make it private "`
 *   `@SerializedName("internal ") val y` became `@SerializedName("private ")`
 * The second one silently renames a JSON field. A refactor that edits a
 * literal is worse than one that does nothing, so anything this file cannot
 * delimit yields no edit at all.
 */
const VISIBILITY_RE = /\b(public|internal|protected)\s+/;

/** Modifiers Kotlin or Java may put between the annotations and the keyword. */
const MODIFIER_RUN_RE = new RegExp(
  '^(?:(?:public|internal|protected|private|open|abstract|final|sealed|data|enum|annotation'
  + '|value|inline|noinline|crossinline|suspend|external|expect|actual|operator|infix|tailrec'
  + '|lateinit|const|override|companion|static|synchronized|native|strictfp|transient'
  + '|volatile|default)\\s+)*',
);

/** Keywords that end the modifier run. Used only as a safety net. */
const DECLARATION_RE = /\b(class|object|interface|fun|val|var|typealias|enum|constructor|init|companion|record)\b/;

export interface PrivateEdit {
  /** Column where the edit starts. */
  column: number;
  /** Characters to replace, 0 for an insertion. */
  length: number;
  text: 'private ';
}

/**
 * Length of the leading run of annotations, parentheses balanced and string
 * bodies skipped. `-1` when an annotation cannot be closed on this line: the
 * caller then offers nothing rather than guess where it ends.
 */
function annotationRunLength(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  while (line[i] === '@') {
    let j = i + 1;
    while (j < line.length && /[\w.]/.test(line[j])) j++;
    if (line[j] === '(') {
      let depth = 0;
      let closed = false;
      for (; j < line.length; j++) {
        const c = line[j];
        if (c === '"' || c === "'") {
          const quote = c;
          j++;
          while (j < line.length && line[j] !== quote) { if (line[j] === '\\') j++; j++; }
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) { j++; closed = true; break; } }
      }
      if (!closed) return -1;
    }
    let k = j;
    while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k++;
    if (k === j) return -1;   // `@Foo` glued to what follows: not understood
    i = k;
  }
  return i;
}

/** Undefined when the line is already private, or holds nothing to narrow. */
export function narrowToPrivate(lineText: string): PrivateEdit | undefined {
  if (lineText.trim() === '') return undefined;
  const afterAnnotations = annotationRunLength(lineText);
  if (afterAnnotations < 0) return undefined;

  const reste = lineText.slice(afterAnnotations);
  const modifiers = MODIFIER_RUN_RE.exec(reste)?.[0] ?? '';
  if (/\bprivate\b/.test(modifiers)) return undefined;

  const visibility = VISIBILITY_RE.exec(modifiers);
  if (visibility) {
    return { column: afterAnnotations + visibility.index, length: visibility[0].length, text: 'private ' };
  }

  // Safety net: between the end of the modifiers and the declaration keyword
  // there is nothing left to read. A visibility keyword sitting THERE means the
  // line was not understood, and inserting would produce two of them.
  const apresModifiers = reste.slice(modifiers.length);
  const decl = DECLARATION_RE.exec(apresModifiers);
  const fenetre = decl ? apresModifiers.slice(0, decl.index) : apresModifiers;
  if (VISIBILITY_RE.test(fenetre)) return undefined;

  return { column: afterAnnotations, length: 0, text: 'private ' };
}
