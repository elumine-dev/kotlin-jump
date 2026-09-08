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
export function segmentMatchesPath(uriPath: string, segment: string): boolean {
  const s = segment.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
  if (!s) return false;
  // Callers pass `Uri.fsPath` as often as `Uri.path`, and on Windows fsPath
  // separates with backslashes. Matching only on `/` meant no file was ever
  // recognised as a test file there, so the filter that hides test results
  // from a production file was inverted.
  const p = uriPath.replace(/\\/g, '/');
  if (p.includes(`/${s}/`) || p.endsWith(`/${s}`)) return true;

  // Gradle builds a variant source set by suffixing the base name in camel
  // case: `androidTest` becomes `androidTestDebug`, `jvmTest` becomes
  // `jvmTestFixtures`. Requiring an exact component missed all of them.
  // The suffix must start with an upper case letter, so `test` still does not
  // match a directory named `testdata`, and a segment naming a directory pair
  // such as `test/kotlin` still never matches `test/kotlin-jump-demo`.
  if (s.includes('/')) return false;
  return p.split('/').some(c => c.length > s.length && c.startsWith(s) && /^[A-Z]/.test(c[s.length]!));
}

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
