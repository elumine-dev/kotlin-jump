import * as vscode from 'vscode';
import { corpusUri } from '../util/corpusUri';
import { CascadePlan, Cut, planCascade } from './removalCascade';

/**
 * The VS Code half of KJ-048.
 *
 * The plan is consulted BEFORE the caller writes its own edits, and the caller
 * adds no range edit for a file the plan deletes. VS Code rejects a
 * WorkspaceEdit that both deletes a URI and edits a range in it, silently and
 * as a whole, so the order is part of the contract rather than a preference.
 */
export { planCascade };

/** Deletions first, then the imports of the files that survive. */
export function addCascadePlan(
  edit: vscode.WorkspaceEdit,
  plan: CascadePlan,
  textByPath: ReadonlyMap<string, string>,
): { imports: number; files: number } {
  for (const path of plan.deleteFiles) {
    edit.deleteFile(
      corpusUri(path),
      { ignoreIfNotExists: true },
      { needsConfirmation: true, label: `Delete ${path.split(/[\\/]/).pop()}, nothing is left in it` },
    );
  }

  let imports = 0;
  for (const [path, extents] of plan.imports) {
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
  return { imports, files: plan.deleteFiles.size };
}

/**
 * One file, one cut: the shape every per finding lightbulb has. Returns the
 * plan so the caller can skip its own range edit when the file is going.
 */
export function planOneFile(path: string, text: string, cut: Cut): CascadePlan {
  return planCascade(new Map([[path, [cut]]]), new Map([[path, text]]));
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
