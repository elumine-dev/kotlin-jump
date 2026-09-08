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
export function makeExclusionMatcher(
  patterns: readonly string[],
  // Workspace folder paths: `app/build/**` is relative to one of them for
  // findFiles, and the watcher tested only the absolute path, so the first
  // Gradle build indexed `app/build/generated/**` behind the scan's back.
  roots: readonly string[] = [],
): (path: string) => boolean {
  if (patterns.length === 0) return () => false;
  const matchers = patterns.map(p => picomatch(p, { dot: true }));
  const prefixes = roots.map(r => r.replace(/\/+$/, '') + '/');
  return (path: string) => {
    if (matchers.some(m => m(path))) return true;
    for (const prefix of prefixes) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (matchers.some(m => m(rel))) return true;
    }
    return false;
  };
}
