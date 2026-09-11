import * as vscode from 'vscode';
import { isTestPath, isTestSourceSet } from './testPaths';

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
  // `isTestSourceSet` et non `isTestPath` : la liste configuree ne peut pas
  // suivre les source sets qu'un vrai projet invente, et la convention Gradle
  // les rattrape. Les detecteurs de code mort l'utilisent depuis toujours ;
  // ce filtre, lui, n'avait que la liste, donc 29 fichiers de test d'un projet
  // reel passaient pour de la production. L'auto import pouvait alors proposer
  // d'importer une classe declaree dans un source set de test, ce qui ne
  // compile pas.
  const currentIsTest = isTestSourceSet(currentFilePath, segments);
  return (path: string) => currentIsTest || !isTestSourceSet(path, segments);
}
