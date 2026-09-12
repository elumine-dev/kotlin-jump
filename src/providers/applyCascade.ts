import * as vscode from 'vscode';
import { corpusUri } from '../util/corpusUri';
import { Cascade, Cut, cascadeAfterRemoval } from './removalCascade';

/**
 * The VS Code half of KJ-048: turns a cascade into edits on an existing
 * WorkspaceEdit.
 *
 * Rule kept from the rest of the family: never a deleteFile AND range edits on
 * the same URI in one WorkspaceEdit, or VS Code rejects the whole thing
 * without a word.
 */
export function addCascade(
  edit: vscode.WorkspaceEdit,
  cutsByPath: ReadonlyMap<string, readonly Cut[]>,
  textByPath: ReadonlyMap<string, string>,
  /** URIs this edit already deletes whole. */
  deleted: ReadonlySet<string> = new Set(),
): { imports: number; files: number } {
  const cascade: Cascade = cascadeAfterRemoval(cutsByPath, textByPath);
  let imports = 0;
  const emptied = new Set(cascade.emptyFiles);

  for (const path of cascade.emptyFiles) {
    if (deleted.has(path)) continue;
    edit.deleteFile(
      corpusUri(path),
      { ignoreIfNotExists: true },
      { needsConfirmation: true, label: `Delete ${path.split(/[\\/]/).pop()}, nothing is left in it` },
    );
  }

  for (const [path, extents] of cascade.imports) {
    if (deleted.has(path) || emptied.has(path)) continue;
    const text = textByPath.get(path);
    if (text === undefined) continue;
    const starts = lineStarts(text);
    for (const e of extents) {
      edit.replace(
        corpusUri(path),
        new vscode.Range(posAt(starts, e.start), posAt(starts, e.end)),
        '',
        { needsConfirmation: true, label: 'Remove the import it was the last user of' },
      );
      imports++;
    }
  }
  return { imports, files: cascade.emptyFiles.filter(p => !deleted.has(p)).length };
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1);
  return out;
}

function posAt(starts: readonly number[], offset: number): vscode.Position {
  let low = 0, high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid; else high = mid - 1;
  }
  return new vscode.Position(low, offset - starts[low]);
}
