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
 * The scheme rules out `jar:`, `git:` and every read only view of a file that
 * lives somewhere else, and the `.jar!` segment rules out an archive entry
 * whatever scheme it arrives under.
 */
export function estUnFichierReel(doc: vscode.TextDocument): boolean {
  // `untitled:` passe : un tampon sans titre ou l'on colle du Kotlin est du
  // code que l'utilisateur ecrit, et un linter qui ne lit que le fichier sous
  // ses yeux y a toute sa place. L'exclure etait un exces de la premiere
  // version de cette garde.
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return false;
  return !doc.uri.path.includes('.jar!');
}

/**
 * ... and inside a folder of this workspace.
 *
 * Two levels, because the providers do not ask the same thing. A diagnostic
 * that compares code against the PROJECT's resource index has no meaning
 * outside the project, so it needs the folder. A linter that only reads the
 * file in front of it needs nothing else, and requiring the folder for it
 * silently turned it off the moment a file was opened on its own.
 */
export function estDansLEspaceDeTravail(doc: vscode.TextDocument): boolean {
  return estUnFichierReel(doc) && vscode.workspace.getWorkspaceFolder(doc.uri) !== undefined;
}
