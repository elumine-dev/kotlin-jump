import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { Logger } from '../util/logger';
import { analyzeDocument, WhenAnalysis } from '../providers/SealedWhenCoverageProvider';

// Click target of the sealed-when coverage CodeLens: inserts the missing
// branches (before `else` when present, else before the closing brace),
// mirroring IntelliJ's "Add remaining branches".
//
// The command re-analyzes the LIVE document instead of trusting the lens
// payload — the document may have changed since the lens rendered. A stale
// or vanished `when` degrades to an information message, never a bad edit.

/** How far the `when` may have drifted from the lens line and still match. */
const LINE_TOLERANCE = 3;

export interface MissingBranchEdit {
  insertAt: vscode.Position;
  text: string;
  /** Where the cursor should land: on the first inserted TODO(). */
  cursorLine: number;
}

/** Pure edit builder — exported for unit tests. */
export function buildMissingBranchEdit(analysis: WhenAnalysis): MissingBranchEdit {
  const lines = analysis.missing.map(entry => {
    // `is X ->` does not compile for enum ENTRIES, and the bare name is the
    // idiomatic form for objects — kind-aware emission is mandatory. An enum
    // CLASS implementing a sealed interface (kind 'enum' under a sealed
    // parent) is a type and still needs `is `.
    const bare = entry.kind === 'object' || analysis.parentKind === 'enum';
    const prefix = bare ? '' : 'is ';
    return `${analysis.branchIndent}${prefix}${analysis.insertPrefix}${entry.name} -> TODO()`;
  });
  return {
    insertAt: new vscode.Position(analysis.insertLine, 0),
    text: lines.join('\n') + '\n',
    cursorLine: analysis.insertLine,
  };
}

export function registerAddMissingWhenBranches(
  context: vscode.ExtensionContext,
  index: SymbolIndex,
  log?: Logger,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'kotlin-jump.addMissingWhenBranches',
      async (uri: vscode.Uri, whenLine: number) => {
        log?.info(`[SealedWhen] insert command — ${uri.path.split('/').pop()} when@${whenLine + 1}`);
        const document = await vscode.workspace.openTextDocument(uri);
        const analyses = analyzeDocument(document, index);

        let best: WhenAnalysis | undefined;
        for (const a of analyses) {
          if (a.missing.length === 0) continue;
          const drift = Math.abs(a.whenLine - whenLine);
          if (drift <= LINE_TOLERANCE && (!best || drift < Math.abs(best.whenLine - whenLine))) {
            best = a;
          }
        }
        if (!best) {
          log?.warn(`[SealedWhen] insert no-op — when@${whenLine + 1} not found or already complete (document changed?)`);
          void vscode.window.showInformationMessage(
            'Kotlin Jump: this when expression changed — no missing branches found at this location.',
          );
          return;
        }

        const edit = buildMissingBranchEdit(best);
        const ws = new vscode.WorkspaceEdit();
        ws.insert(uri, edit.insertAt, edit.text);
        const applied = await vscode.workspace.applyEdit(ws);
        log?.info(
          `[SealedWhen] inserted ${best.missing.length} branch(es) at line ${edit.insertAt.line + 1}` +
          ` — ${best.missing.map(e => e.name).join(', ')} (applied=${applied})`,
        );
        if (!applied) return;

        // Land the cursor on the first inserted TODO() so Tab-through-fixes
        // flows naturally (same UX as IntelliJ's "Add remaining branches").
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const lineText = editor.document.lineAt(edit.cursorLine).text;
        const todoCol = Math.max(lineText.indexOf('TODO()'), 0);
        const pos = new vscode.Position(edit.cursorLine, todoCol);
        editor.selection = new vscode.Selection(pos, new vscode.Position(edit.cursorLine, todoCol + 'TODO()'.length));
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      },
    ),
  );
}
