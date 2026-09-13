import * as vscode from 'vscode';

/**
 * True when a document is a file of the workspace, and not something that
 * merely reads like one.
 *
 * A source jar from the Gradle cache opens as
 * `…/databinding-runtime-9.3.1-sources.jar!androidx/databinding/ObservableField.java`
 * with `languageId === 'java'`, so a provider that gates on the language alone
 * scans it as if the user had written it. Kotlin Jump put an ERROR on one of
 * those, `Cannot resolve string resource 'name'`, in a file the user cannot
 * open, let alone fix.
 *
 * Two conditions, and both are needed. The scheme rules out `jar:`, `git:`,
 * `untitled:` and every virtual document; the workspace folder rules out a
 * real file on disk that simply is not part of this project, which is what the
 * Gradle cache is.
 */
export function estDansLEspaceDeTravail(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file') return false;
  if (doc.uri.path.includes('.jar!')) return false;
  return vscode.workspace.getWorkspaceFolder(doc.uri) !== undefined;
}
