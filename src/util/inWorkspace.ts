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
/**
 * Read case insensitively, and on the layout rather than the address.
 *
 * Comparing segments literally failed twice. The filesystem underneath does
 * not care about case: `~/Library/Android/SDK/...` and
 * `~/Library/Android/sdk/...` are the same inode on macOS, Windows behaves the
 * same way, and the case that reaches us is whatever the user typed. And
 * neither tree has to sit where its installer put it, since `ANDROID_HOME` and
 * `GRADLE_USER_HOME` move them.
 *
 * What does not move is what is inside: an SDK keeps its platform sources
 * under `sources/android-<api level>`, and Gradle keeps its downloads under
 * `caches/modules-2`. The API level has to be a number, so a folder of one's
 * own named `sources/android-utils` stays the user's.
 */
const RACINES_DE_DEPENDANCE = [
  /\/\.gradle\/caches\//i,
  /\/caches\/modules-2\//i,
  /\/\.m2\/repository\//i,
  /\/android\/sdk\/sources\//i,
  /\/sources\/android-\d+\//i,
  /\/\.konan\//i,
];

/**
 * A dependency's source tree, unpacked on disk rather than read through an
 * archive.
 *
 * `Go to Definition` on a framework class opens
 * `~/Library/Android/sdk/sources/android-35/android/webkit/FindActionModeCallback.java`,
 * one of 15138 java files that are as real as any other and that no user can
 * edit. The `.jar!` segment says nothing about them, and a warning published
 * there is the same noise as the one that started all of this.
 */
const estUneSourceDeDependance = (chemin: string): boolean =>
  RACINES_DE_DEPENDANCE.some(r => r.test(chemin));

export function estUnFichierReel(doc: vscode.TextDocument): boolean {
  // `untitled:` passe : un tampon sans titre ou l'on colle du Kotlin est du
  // code que l'utilisateur ecrit, et un linter qui ne lit que le fichier sous
  // ses yeux y a toute sa place. L'exclure etait un exces de la premiere
  // version de cette garde.
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return false;
  if (doc.uri.path.includes('.jar!')) return false;
  // The folder is an escape hatch, not the rule. A file of the project is ours
  // whatever its path reads like; a file outside it is ours only when it does
  // not sit in a dependency root. Asking for the folder outright is what shut
  // these linters off on a file opened on its own.
  if (vscode.workspace.getWorkspaceFolder(doc.uri) !== undefined) return true;
  return !estUneSourceDeDependance(doc.uri.path);
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
