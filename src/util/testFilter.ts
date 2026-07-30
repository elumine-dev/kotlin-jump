import * as vscode from 'vscode';
import { isTestPath } from './testPaths';

// Moved to ./testPaths.ts so a plain Node script can classify a path.
// Re-exported: the existing suites and providers import them from here.
export { isTestPath, segmentMatchesPath } from './testPaths';

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
