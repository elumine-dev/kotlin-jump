import * as vscode from 'vscode';

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
function segmentMatchesPath(uriPath: string, segment: string): boolean {
  const s = segment.replace(/^\/+|\/+$/g, '');
  if (!s) return false;
  return uriPath.includes(`/${s}/`) || uriPath.endsWith(`/${s}`);
}

export function isTestPath(uriPath: string, segments: string[]): boolean {
  return segments.some(s => segmentMatchesPath(uriPath, s));
}

/**
 * Returns a filter function that excludes test-source files when the caller
 * is in a main-source file, and allows everything when the caller is already
 * in a test file.  Reads `kotlinJump.testSourceSets` from VS Code settings —
 * the schema default (`test/kotlin`, `test/java`, etc.) applies when the user
 * has not overridden the setting.
 */
export function buildAllowFilter(currentFilePath: string): (path: string) => boolean {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const segments = cfg.get<string[]>('testSourceSets', []);
  const currentIsTest = isTestPath(currentFilePath, segments);
  return (path: string) => currentIsTest || !isTestPath(path, segments);
}
