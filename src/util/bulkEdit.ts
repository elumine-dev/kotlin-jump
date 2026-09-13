import * as vscode from 'vscode';

/** What the user chose to do with a workspace wide edit. */
export type BulkChoice = 'apply' | 'review' | 'cancel';

const APPLIQUER = 'Apply all';
const RELIRE = 'Review one by one';

/**
 * How a bulk edit reaches the workspace.
 *
 * `needsConfirmation: true` is what opens the Refactor Preview, and it is the
 * same flag that leaves every box in it UNCHECKED. That view has no "select
 * all", so accepting 171 narrowings spread over 43 files meant 43 clicks before
 * the Apply button, one per file, with no way to say yes to the lot.
 *
 * So the question is asked once, up front, where one click answers for
 * everything. Whoever wants to read the preview still gets it, unchanged.
 */
export async function askHowToApply(resume: string, detail: string): Promise<BulkChoice> {
  const answer = await vscode.window.showInformationMessage(
    resume, { modal: true, detail }, APPLIQUER, RELIRE,
  );
  if (answer === APPLIQUER) return 'apply';
  if (answer === RELIRE) return 'review';
  return 'cancel';
}

/**
 * The detail line under the question.
 *
 * Exported for the witness: it is the only place the user is told how much is
 * about to happen, and a count that disagrees with the edit would be worse
 * than no count at all.
 */
export function bulkDetail(edits: number, files: number): string {
  return `${edits} change${edits > 1 ? 's' : ''} in ${files} file${files > 1 ? 's' : ''}.`
    + ' Apply all skips the preview; review one by one opens it with nothing ticked.';
}
