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
  const s = segment.replace(/^\/+|\/+$/g, '');
  if (!s) return false;
  return uriPath.includes(`/${s}/`) || uriPath.endsWith(`/${s}`);
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
