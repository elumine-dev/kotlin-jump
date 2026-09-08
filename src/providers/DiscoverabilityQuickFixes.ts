import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { analyzeLifecyclePairs, closeFor } from './LifecyclePairingProvider';
import { findOverdueTodos } from './TodoExpiryProvider';
import { analyzeDocument } from './SealedWhenCoverageProvider';
import { buildMissingBranchEdit } from '../commands/addMissingWhenBranches';

/**
 * Lightbulb sweep (Kevin, 25/07): every diagnostic or highlight the
 * extension paints should hand the user its fix through a code action.
 * Users discover features through the lightbulb, not the changelog.
 *
 * This file gathers the quick fixes for features that flagged problems
 * without offering the cure: lifecycle orphans, expired TODOs, `!!`
 * assertions, and non-exhaustive `when` blocks. Resource / dependency /
 * manifest removals already live in DeadWeightActionProvider.
 */

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Shape of the release call for a lifecycle orphan. Mirrors how the
 * resource was acquired: `wakeLock.acquire()` releases as
 * `wakeLock.release()`, `registerReceiver(r)` releases as
 * `unregisterReceiver(r)`.
 */
export function buildReleaseCall(
  acquisitionLine: string,
  open: string,
  close: string,
  resource: string,
): string {
  const methodForm = new RegExp(`\\b${resource}\\s*[.!?]+\\s*${open}\\s*\\(`);
  return methodForm.test(acquisitionLine)
    ? `${resource}.${close}()`
    : `${close}(${resource})`;
}

export interface NullAssertionRewrite {
  title: string;
  /** Replacement for the `expr!!` token (safe call keeps the trailing dot). */
  find: string;
  replace: string;
}

/**
 * Rewrites offered for the `!!` nearest to the caret on one line.
 * `x!!.foo` becomes a safe call; a standalone `x!!` wraps in
 * requireNotNull. Returns null when the line has no assertion.
 */
export function nullAssertionRewrites(lineText: string): NullAssertionRewrite | null {
  const m = /([A-Za-z_][\w.]*)!!(\.)?/.exec(lineText);
  if (!m) return null;
  if (m[2]) {
    return {
      title: `Replace !! with safe call: ${m[1]}?.`,
      find: `${m[1]}!!.`,
      replace: `${m[1]}?.`,
    };
  }
  return {
    title: `Wrap in requireNotNull(${m[1]})`,
    find: `${m[1]}!!`,
    replace: `requireNotNull(${m[1]})`,
  };
}

// ── Providers ────────────────────────────────────────────────────────────────

/** Quick fix for lifecycle-pairing warnings: add the missing release. */
export class LifecycleReleaseActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const text = document.getText();
    const { orphans } = analyzeLifecyclePairs(text);
    const orphan = orphans.find(o => o.line === range.start.line);
    if (!orphan) return [];
    // `orphan.open` is the lifecycle method (onStart); the pair table is
    // keyed by the acquiring call. Looked up by the wrong one, this quick
    // fix never appeared at all.
    const close = closeFor(orphan.method);
    if (!close) return [];

    const call = buildReleaseCall(
      document.lineAt(orphan.line).text, orphan.method, close, orphan.resource,
    );
    const action = new vscode.CodeAction(
      `Add ${call} in ${orphan.expectedIn}()`,
      vscode.CodeActionKind.QuickFix,
    );
    action.edit = new vscode.WorkspaceEdit();

    const lines = text.split('\n');
    // The enclosing function's own indentation, tabs included. Deriving it
    // as "acquire indent minus four spaces" put the new function outside the
    // class with tabs or two-space indents, and inside onStart's body when
    // the acquire sat in an if.
    let funLine = orphan.line;
    while (funLine > 0 && !/^\s*(?:override\s+)?(?:\w+\s+)*fun\b/.test(lines[funLine])) funLine--;
    const fnIndent = lines[funLine].match(/^\s*/)?.[0] ?? '';
    const unit = fnIndent.includes('\t') ? '\t' : '    ';
    const mirrorRe = new RegExp(`^${fnIndent}(?:\\w+\\s+)*override\\s+fun\\s+${orphan.expectedIn}\\s*\\([^)]*\\)\\s*\\{`);
    // Same indentation as the acquiring function: the mirror of this class,
    // not the first onStop in the file.
    const mirrorLine = lines.findIndex(l => mirrorRe.test(l));
    if (mirrorLine >= 0) {
      action.edit.insert(
        document.uri,
        new vscode.Position(mirrorLine + 1, 0),
        `${fnIndent}${unit}${call}\n`,
      );
    } else {
      let depth = 0;
      let closeLine = funLine;
      for (let i = funLine; i < lines.length; i++) {
        for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
        if (depth <= 0 && i > funLine) { closeLine = i; break; }
        closeLine = i;
      }
      action.edit.insert(
        document.uri,
        new vscode.Position(closeLine + 1, 0),
        `\n${fnIndent}override fun ${orphan.expectedIn}() {\n${fnIndent}${unit}${call}\n${fnIndent}}\n`,
      );
    }
    return [action];
  }
}

/** Quick fix on an expired TODO(yyyy-mm-dd): remove the stale comment. */
export class ExpiredTodoActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const overdue = findOverdueTodos(document.getText(), Date.now());
    for (const t of overdue) {
      const start = document.positionAt(t.start);
      if (start.line !== range.start.line) continue;
      const lineText = document.lineAt(start.line).text;
      const action = new vscode.CodeAction(
        `Remove expired TODO (${t.dateIso})`,
        vscode.CodeActionKind.QuickFix,
      );
      action.edit = new vscode.WorkspaceEdit();
      if (lineText.trim().startsWith('//')) {
        // Whole-line comment: drop the line.
        action.edit.delete(document.uri, new vscode.Range(start.line, 0, start.line + 1, 0));
      } else {
        // Trailing comment: cut from the `//` to the end of the line.
        const cut = lineText.indexOf('//');
        action.edit.delete(
          document.uri,
          new vscode.Range(start.line, cut === -1 ? start.character : cut, start.line, lineText.length),
        );
      }
      return [action];
    }
    return [];
  }
}

/** Rewrites for `!!` (the highlight flags them, this fixes them). */
export class NullAssertionActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const lineText = document.lineAt(range.start.line).text;
    const rewrite = nullAssertionRewrites(lineText);
    if (!rewrite) return [];
    const at = lineText.indexOf(rewrite.find);
    if (at < 0) return [];
    const action = new vscode.CodeAction(rewrite.title, vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(
      document.uri,
      new vscode.Range(range.start.line, at, range.start.line, at + rewrite.find.length),
      rewrite.replace,
    );
    return [action];
  }
}

/** The sealed-when CodeLens gesture, discoverable from the lightbulb too. */
export class MissingWhenBranchesActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const analyses = analyzeDocument(document, this.index);
    const hit = analyses.find(a =>
      a.missing.length > 0 && range.start.line >= a.whenLine && range.start.line <= a.insertLine,
    );
    if (!hit) return [];
    const edit = buildMissingBranchEdit(hit);
    const action = new vscode.CodeAction(
      `Add ${hit.missing.length} missing when branch${hit.missing.length > 1 ? 'es' : ''}`,
      vscode.CodeActionKind.QuickFix,
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(document.uri, edit.insertAt, edit.text);
    return [action];
  }
}
