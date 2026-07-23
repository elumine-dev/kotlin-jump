import picomatch from 'picomatch';

/**
 * Builds a predicate that matches the `excludePatterns` used by the initial
 * `findFiles` scan (default `**​/build/**` and `**​/.gradle/**`).
 *
 * The initial scan excludes these, but the file-system watchers did not:
 * a Gradle build regenerates hundreds of `.kt`/`.java` files under
 * `build/generated/` (BuildConfig, ViewBinding, Hilt, KSP output), and the
 * watcher re-indexed every one — a churn storm on the extension host,
 * exactly while VS Code's own git integration reacts to the same files.
 * Watching what we deliberately refused to index was pure waste on top.
 */
export function makeExclusionMatcher(patterns: readonly string[]): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const matchers = patterns.map(p => picomatch(p, { dot: true }));
  return (path: string) => matchers.some(m => m(path));
}
