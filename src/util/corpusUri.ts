import * as vscode from 'vscode';

/**
 * The dead-code corpus keys its sources by `fsPath`, and the providers used
 * to rebuild the URI with `vscode.Uri.file(path)`. On vscode.dev / github.dev
 * a file is `vscode-vfs://github/owner/repo/…`, whose fsPath is a plain
 * `/owner/repo/…`: the diagnostics landed on a `file:///owner/repo/…` no
 * editor shows, the Problems panel listed phantom paths, and the quick fixes
 * read a file that does not exist. This keeps the original URI per path.
 */
const uriByPath = new Map<string, vscode.Uri>();

export function rememberCorpusUri(uri: vscode.Uri): string {
  uriByPath.set(uri.fsPath, uri);
  return uri.fsPath;
}

export function corpusUri(path: string): vscode.Uri {
  return uriByPath.get(path) ?? vscode.Uri.file(path);
}
