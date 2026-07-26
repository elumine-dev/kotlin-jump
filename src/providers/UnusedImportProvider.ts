import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-009: Unused import graying, grays out imports whose effective name
 * (alias included) never appears in the code. Mentions inside a comment or a
 * string do not count; `${…}` templates do count (they are code). Wildcard
 * imports are NEVER flagged (conservative: the package contents are
 * unknown).
 */

export interface UnusedImport {
  /** 0-based line of the import. */
  line: number;
  /** Full text of the import line. */
  statement: string;
}

const IMPORT_RE = /^\s*import\s+([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*(?:\/\/.*)?$/;

/** Blanks out comments and string contents while PRESERVING the code inside
 *  `${…}` templates (lengths are kept). */
export function sanitizeForUsageScan(text: string): string {
  const out: string[] = [];
  let i = 0;
  let mode: 'code' | 'line-comment' | 'block-comment' | 'string' | 'raw' = 'code';
  let templateDepth = 0;

  while (i < text.length) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);

    switch (mode) {
      case 'code':
        if (two === '//') { mode = 'line-comment'; out.push('  '); i += 2; continue; }
        if (two === '/*') { mode = 'block-comment'; out.push('  '); i += 2; continue; }
        if (three === '"""') { mode = 'raw'; out.push('   '); i += 3; continue; }
        if (ch === '"') { mode = 'string'; out.push(' '); i++; continue; }
        if (ch === "'") {
          // char literal: blanked out entirely ('A', '\'', '\\', 'A')
          let j = i + 1;
          if (text[j] === '\\') j += 2 + (text[j + 1] === 'u' ? 4 : 0);
          else j += 1;
          if (text[j] === "'") {
            out.push(' '.repeat(j + 1 - i));
            i = j + 1;
            continue;
          }
        }
        out.push(ch);
        i++;
        continue;

      case 'line-comment':
        if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
        i++;
        continue;

      case 'block-comment':
        if (two === '*/') { mode = 'code'; out.push('  '); i += 2; continue; }
        out.push(ch === '\n' ? '\n' : ' ');
        i++;
        continue;

      case 'string':
      case 'raw':
        if (templateDepth > 0) {
          if (ch === '{') templateDepth++;
          if (ch === '}') {
            templateDepth--;
            out.push(templateDepth === 0 ? ' ' : ch);
            i++;
            continue;
          }
          out.push(ch);
          i++;
          continue;
        }
        if (two === '${') { templateDepth = 1; out.push('  '); i += 2; continue; }
        if (mode === 'string') {
          if (ch === '\\') { out.push('  '); i += 2; continue; }
          if (ch === '"') { mode = 'code'; out.push(' '); i++; continue; }
          if (ch === '\n') { mode = 'code'; out.push('\n'); i++; continue; }
        } else if (three === '"""') {
          mode = 'code';
          out.push('   ');
          i += 3;
          continue;
        }
        out.push(ch === '\n' ? '\n' : ' ');
        i++;
        continue;
    }
  }
  return out.join('');
}

export function findUnusedImports(text: string): UnusedImport[] {
  const lines = text.split('\n');
  const imports: { line: number; statement: string; effectiveName: string; wildcard: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = IMPORT_RE.exec(lines[i]);
    if (!m) continue;
    const path = m[1];
    const wildcard = Boolean(m[2]);
    const alias = m[3];
    const lastSegment = path.split('.').pop() ?? path;
    imports.push({
      line: i,
      statement: lines[i],
      effectiveName: alias ?? lastSegment,
      wildcard,
    });
  }
  if (imports.length === 0) return [];

  // Body = sanitized text WITHOUT the import lines themselves.
  const importLines = new Set(imports.map(im => im.line));
  const body = sanitizeForUsageScan(text)
    .split('\n')
    .map((l, idx) => (importLines.has(idx) ? '' : l))
    .join('\n');

  const unused: UnusedImport[] = [];
  for (const im of imports) {
    if (im.wildcard) continue; // conservative
    const usageRe = new RegExp(`\\b${escapeRegExp(im.effectiveName)}\\b`);
    if (!usageRe.test(body)) {
      unused.push({ line: im.line, statement: im.statement });
    }
  }
  return unused;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Code actions that go with the graying: remove ONE unused import (cursor on
 * it) or ALL of them at once.
 */
export class UnusedImportCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('unusedImportGraying', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const unused = findUnusedImports(document.getText());
    if (unused.length === 0) return [];

    const deleteLines = (lines: number[]): vscode.WorkspaceEdit => {
      const edit = new vscode.WorkspaceEdit();
      // descending order: deletions do not shift the following ones
      for (const line of [...lines].sort((a, b) => b - a)) {
        edit.delete(document.uri, new vscode.Range(line, 0, line + 1, 0));
      }
      return edit;
    };

    const actions: vscode.CodeAction[] = [];

    const onUnusedLine = unused.find(u => u.line === range.start.line);
    if (onUnusedLine) {
      const single = new vscode.CodeAction('Remove unused import', vscode.CodeActionKind.QuickFix);
      single.edit = deleteLines([onUnusedLine.line]);
      actions.push(single);
    }

    if (unused.length > 1 || !onUnusedLine) {
      const all = new vscode.CodeAction(
        `Remove all unused imports (${unused.length})`,
        vscode.CodeActionKind.QuickFix,
      );
      all.edit = deleteLines(unused.map(u => u.line));
      actions.push(all);
    }
    return actions;
  }
}

const DEBOUNCE_MS = 400;

export class UnusedImportProvider implements vscode.Disposable {
  private readonly _decoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.45',
  });
  private readonly _subs: vscode.Disposable[];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) this._refreshDebounced();
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.unusedImportGraying')) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refreshDebounced(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refresh(), DEBOUNCE_MS);
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('unusedImportGraying', true);
    if (!enabled) {
      editor.setDecorations(this._decoration, []);
      return;
    }

    const ranges = findUnusedImports(editor.document.getText()).map(u => {
      const start = u.statement.length - u.statement.trimStart().length;
      return new vscode.Range(u.line, start, u.line, u.statement.length);
    });
    editor.setDecorations(this._decoration, ranges);
    reportDecorations('unusedImports', ranges.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._decoration.dispose();
    for (const s of this._subs) s.dispose();
  }
}
