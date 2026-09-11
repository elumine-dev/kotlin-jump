/**
 * Test source set path matching, with no vscode dependency.
 *
 * Split out of `testFilter.ts` (which reads settings, hence needs vscode) so
 * KJ-032's core and its dry-run harness can classify a reference as coming
 * from a test source set without an extension host.
 */

/**
 * True iff `uriPath` contains `segment` as a full path component —
 * bounded by `/` on both sides, or `/` + end-of-path.
 *
 * Plain `path.includes(segment)` is too loose: the segment `"test/kotlin"`
 * would match `".../test/kotlin-jump-demo/..."` (a repo directory that
 * simply starts with the same letters), misclassifying every file in
 * that repo as a test file. Matching on bounded components eliminates
 * that false positive while still correctly identifying real test
 * source sets like `".../src/test/kotlin/..."`.
 */
interface ParsedSegment {
  /** Normalised segment, e.g. `test/kotlin`. */
  text: string;
  /** `/test/kotlin/` and `/test/kotlin`, built once. */
  inner: string;
  suffix: string;
  /** Component that may carry the Gradle variant suffix, absent when the
   *  segment names nothing beyond `src` and only the exact rule applies. */
  base: string | undefined;
  /** What the segment names after that component, required verbatim. */
  tail: string[];
}

// The segments come from a setting and never change between calls, but this is
// called once per candidate on the Go to Definition path and once per symbol in
// the dead code scan. Parsing them on every call made the whole function three
// times more expensive than before variant source sets were supported.
const PARSED = new Map<string, ParsedSegment | null>();

function parseSegment(segment: string): ParsedSegment | null {
  const hit = PARSED.get(segment);
  if (hit !== undefined) return hit;
  const text = segment.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
  const want = text.split('/');
  // A segment written with its own `src` prefix names the same thing as one
  // without: only what follows carries the variant suffix.
  if (want[0] === 'src') want.shift();
  const [base, ...tail] = want;
  // `text` empty is the only reason to refuse the segment outright. A segment
  // of exactly `src` still matches exactly; it simply has no variant to look
  // for, and dropping it here silently disabled the exact rule as well.
  const parsed: ParsedSegment | null = text
    ? { text, inner: `/${text}/`, suffix: `/${text}`, base, tail }
    : null;
  PARSED.set(segment, parsed);
  return parsed;
}

/** Is the component starting at `from` a variant of `base`, followed by `tail`? */
function variantAt(p: string, from: number, seg: ParsedSegment): boolean {
  const { base, tail } = seg;
  if (base === undefined) return false;
  if (!p.startsWith(base, from)) return false;
  const after = from + base.length;
  const c = p.charCodeAt(after);
  // The suffix must exist and start upper case: `androidTestDebug` yes,
  // `testdata` no, and a bare `androidTest` is the exact match handled above.
  if (!(c >= 65 && c <= 90)) return false;

  let end = p.indexOf('/', after);
  if (end < 0) end = p.length;
  for (const want of tail) {
    if (end >= p.length) return false;
    let next = p.indexOf('/', end + 1);
    if (next < 0) next = p.length;
    if (next - end - 1 !== want.length || !p.startsWith(want, end + 1)) return false;
    end = next;
  }
  return true;
}

export function segmentMatchesPath(uriPath: string, segment: string): boolean {
  const seg = parseSegment(segment);
  if (!seg) return false;
  // Callers pass `Uri.fsPath` as often as `Uri.path`, and on Windows fsPath
  // separates with backslashes. Matching only on `/` meant no file was ever
  // recognised as a test file there, so the filter that hides test results
  // from a production file was inverted.
  const p = uriPath.indexOf('\\') < 0 ? uriPath : uriPath.replace(/\\/g, '/');
  if (p.includes(seg.inner) || p.endsWith(seg.suffix)) return true;

  // Gradle builds a variant source set by suffixing the base name in camel
  // case: `androidTest` becomes `androidTestDebug`, `test/java` becomes
  // `testDebug/java`. Requiring an exact component missed all of them.
  //
  // The rule is anchored on the component that directly follows `src`, which
  // is where Gradle puts the source set name. Scanning every component instead
  // classified a module named `androidTestUtils`, and even a production file
  // named `androidTestHelper.kt`, as test code, and Go to Definition then
  // hid them from every production file. Walking the few `src` positions
  // avoids splitting the whole path into components on every call.
  if (seg.base === undefined) return false;
  if (p.startsWith('src/') && variantAt(p, 4, seg)) return true;
  for (let at = p.indexOf('/src/'); at >= 0; at = p.indexOf('/src/', at + 1)) {
    if (variantAt(p, at + 5, seg)) return true;
  }
  return false;
}

/**
 * The declared default of `kotlinJump.testSourceSets`, kept in one place.
 *
 * `get(key, fallback)` never returns that fallback for a contributed setting,
 * so the six call sites that passed `[]` were reading an empty list only under
 * a test stub. Three spellings coexisted for one key: `[]`, a constant named
 * DEFAULT_TEST_SEGMENTS that was itself `[]`, and this array written out.
 */
export const DEFAULT_TEST_SEGMENTS: string[] =
  ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

export function isTestPath(uriPath: string, segments: readonly string[]): boolean {
  return segments.some(s => segmentMatchesPath(uriPath, s));
}

/**
 * Gradle's own convention: a source set directly under `src/` whose name
 * contains "test" is a test source set.
 *
 * A configured list can never keep up. Real projects ship `savedAndroidTest`,
 * `screenshotTest`, `benchmarkTest`, `sharedTest`, and one `test<Flavor>` per
 * product flavour. Measured on a 3444-file project, relying on the configured
 * list alone reported twelve test classes as dead production code.
 *
 * Erring on the side of "this is a test" costs recall, never correctness: a
 * symbol we wrongly treat as test-declared is simply not reported.
 */
const GRADLE_TEST_SOURCE_SET_RE = /[\\/]src[\\/][^\\/]*[Tt]est[^\\/]*[\\/]/;

export function isTestSourceSet(uriPath: string, segments: readonly string[]): boolean {
  return isTestPath(uriPath, segments) || GRADLE_TEST_SOURCE_SET_RE.test(uriPath);
}
