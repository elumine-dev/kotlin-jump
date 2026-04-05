import * as vscode from 'vscode';

export interface OrganizeImportsOptions {
  removeUnused?: boolean; // default: true
}

export interface OrganizeResult {
  firstLine:   number;
  lastLine:    number;
  replacement: string;   // new import block (no trailing newline)
  removed:     string[]; // full text of removed import lines (for reporting)
}

interface ParsedImport {
  path:        string;  // e.g., "com.example.Foo" or "com.example.*"
  alias?:      string;  // e.g., "Bar" from "import Foo as Bar"
  isWildcard:  boolean;
  simpleName:  string;  // alias if present, last path segment otherwise, '' for wildcards
  fullText:    string;  // original trimmed line — preserved verbatim in output
}

// Matches Kotlin and Java (static) import lines.
// Group 1: import path   Group 2: optional alias
const RE_IMPORT_LINE =
  /^\s*import\s+(?:static\s+)?([\w.*]+)(?:\s+as\s+(\w+))?\s*(?:\/\/.*)?$/;

// ── Pure function (no vscode dep) ────────────────────────────────────────────

export function organizeImports(
  text: string,
  options: OrganizeImportsOptions = {},
): OrganizeResult | null {
  const removeUnused = options.removeUnused ?? true;
  const lines = text.split('\n');

  // ── 1. Find import block boundaries ──────────────────────────────────────
  let firstLine = -1;
  let lastLine  = -1;
  for (let i = 0; i < lines.length; i++) {
    if (RE_IMPORT_LINE.test(lines[i])) {
      if (firstLine === -1) firstLine = i;
      lastLine = i;
    }
  }
  if (firstLine === -1) return null;

  // ── 2. Parse each import line in the block ────────────────────────────────
  const parsed: ParsedImport[] = [];
  for (let i = firstLine; i <= lastLine; i++) {
    const m = RE_IMPORT_LINE.exec(lines[i]);
    if (!m) continue; // blank line or comment inside block — dropped
    const path       = m[1];
    const alias      = m[2] ?? undefined;
    const isWildcard = path.endsWith('.*');
    const lastSeg    = path.split('.').pop() ?? path;
    const simpleName = alias ?? (isWildcard ? '' : lastSeg);
    parsed.push({
      path,
      alias,
      isWildcard,
      simpleName,
      fullText: lines[i].trim(), // preserve `static`, backtick names, etc.
    });
  }
  if (parsed.length === 0) return null;

  // ── 3. Remove exact duplicates (first occurrence wins) ───────────────────
  const seen    = new Set<string>();
  const deduped: ParsedImport[] = [];
  for (const imp of parsed) {
    if (!seen.has(imp.fullText)) {
      seen.add(imp.fullText);
      deduped.push(imp);
    }
  }

  // ── 4. Remove unused imports (heuristic) ─────────────────────────────────
  // File body = everything except the import block — prevents the import line
  // itself from being counted as a "usage" of the imported name.
  const fileBody =
    lines.slice(0, firstLine).join('\n') + '\n' +
    lines.slice(lastLine + 1).join('\n');

  const removed: string[] = [];
  const kept:    ParsedImport[] = [];

  for (const imp of deduped) {
    // Wildcards and aliasless wildcards can't be usage-checked — always keep.
    if (!removeUnused || imp.isWildcard || !imp.simpleName) {
      kept.push(imp);
      continue;
    }
    const re = new RegExp(`\\b${escapeRe(imp.simpleName)}\\b`);
    if (re.test(fileBody)) {
      kept.push(imp);
    } else {
      removed.push(imp.fullText);
    }
  }

  // ── 5. Sort alphabetically by path ───────────────────────────────────────
  kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    firstLine,
    lastLine,
    replacement: kept.map(i => i.fullText).join('\n'),
    removed,
  };
}

// ── VS Code provider ─────────────────────────────────────────────────────────

export class OrganizeImportsProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.SourceOrganizeImports,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] | undefined {
    // Only respond to explicit "Organize Imports" requests — not every code-action
    // trigger (e.g. light-bulb). This prevents the action showing up in random menus.
    if (!context.only?.contains(vscode.CodeActionKind.SourceOrganizeImports)) {
      return undefined;
    }
    const edit = buildOrganizeEdit(document);
    if (!edit) return undefined;

    const action = new vscode.CodeAction(
      'Organize Imports',
      vscode.CodeActionKind.SourceOrganizeImports,
    );
    action.edit = edit;
    action.isPreferred = true;
    return [action];
  }
}

export function buildOrganizeEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  const cfg = vscode.workspace.getConfiguration('kotlinJump.organizeImports');
  const removeUnused = cfg.get<boolean>('removeUnused', true);
  const result = organizeImports(document.getText(), { removeUnused });
  if (!result) return undefined;

  const startPos = new vscode.Position(result.firstLine, 0);
  const endPos   = document.lineAt(result.lastLine).range.end;
  const edit     = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(startPos, endPos), result.replacement);
  return edit;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
