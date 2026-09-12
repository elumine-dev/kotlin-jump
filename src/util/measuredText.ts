import * as vscode from 'vscode';

/**
 * An offset is only valid against the text it was measured on.
 *
 * `isDirty` answers a different question: it says whether the EDITOR changed
 * the document, not whether the document is still what the scan read. A file
 * reloaded from disk by a checkout, a stash pop or another tool comes back
 * CLEAN with new content, and the corpus keeps its copy for a minute. An edit
 * placed with the old offsets then lands on the wrong lines.
 *
 * Returns the measured text when it is still what an edit would land in, and
 * undefined when the caller must skip this file.
 */
export function stillTheMeasuredText(
  path: string,
  measured: string | undefined,
): string | undefined {
  if (measured === undefined) return undefined;
  const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === path);
  if (open === undefined) return measured;   // nothing open: the disk copy is what we read
  return open.getText() === measured ? measured : undefined;
}
