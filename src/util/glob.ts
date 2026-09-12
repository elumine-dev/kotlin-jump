/**
 * The glob dialect the ignore settings accept: `*`, `**` and `?`.
 *
 * Three providers each carried their own copy of this translation, and none of
 * the three read `?`, which every one of those settings advertises by calling
 * its values globs. Left untranslated the character stays a REGULAR EXPRESSION
 * quantifier, so a pattern ending in `Test?.kt` did the opposite of what it
 * says on both sides: it kept `Test.kt` out of the report, the `t` having
 * become optional, and let `Test1.kt` in. A `?` with nothing before it does
 * not even compile, and that throw crossed `findUnusedSymbols` uncaught,
 * taking the nine other detectors of the aggregate command down with it.
 *
 * A `**` followed by a slash spans zero or more directories, the way the
 * editor's own globs and gitignore read it. Demanding at least one is what
 * made the shipped default for `buildSrc` match nothing on the standard Gradle
 * layout, where that directory sits at the root of the workspace.
 *
 * Braces and character classes stay literal on purpose. Reading them would
 * widen what a list of exclusions takes out, and that is the direction that
 * hides a real finding.
 *
 * The markers are parked as escapes, never as raw bytes: a raw control byte
 * makes git read the whole file as binary and stop showing its diffs.
 */
const compiles = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const deja = compiles.get(pattern);
  if (deja) return deja;
  const re = new RegExp(
    '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0000')   // zero or more directories, parked
      .replace(/\*\*/g, '\u0001')     // anything at all, parked
      .replace(/\*/g, '[^/]*')
      // Before the two markers open up: the one for zero or more directories
      // carries a `?` of its own, and this pass would read it as a glob.
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '(?:.*/)?')
      .replace(/\u0001/g, '.*') + '$',
  );
  compiles.set(pattern, re);
  return re;
}

/** Whether `path`, or a bare name, answers the glob `pattern`. */
export function matchesGlob(path: string, pattern: string): boolean {
  return compile(pattern).test(path);
}
