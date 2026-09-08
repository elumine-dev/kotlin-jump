import * as vscode from 'vscode';
import { importBlockBounds } from '../util/importBlock';
import { CONVENTION_FUN_NAMES } from '../util/kotlinScan';

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
// The optional `;` is Java: without it no Java line was an import at all and
// "Organize Imports" silently did nothing on a .java file.
const RE_IMPORT_LINE =
  /^\s*import\s+(?:static\s+)?([\w.*]+)(?:\s+as\s+(\w+))?\s*;?\s*(?:\/\/.*)?$/;

// Names Kotlin resolves by convention, never spelled at the use site:
// `getValue`/`setValue` behind `by remember`, `plus` behind `a + b`,
// `component1` behind a destructuring. The unused-import diagnostic already
// keeps them; this action removed them and the file stopped compiling.
function isResolvedByConvention(simpleName: string): boolean {
  return CONVENTION_FUN_NAMES.has(simpleName) || /^component\d+$/.test(simpleName);
}

// ── Pure function (no vscode dep) ────────────────────────────────────────────

export function organizeImports(
  text: string,
  options: OrganizeImportsOptions = {},
): OrganizeResult | null {
  const removeUnused = options.removeUnused ?? true;
  const lines = text.split('\n');

  // ── 1. Find import block boundaries ──────────────────────────────────────
  const bounds = importBlockBounds(lines, l => RE_IMPORT_LINE.test(l));
  if (!bounds) return null;
  const firstLine = bounds.first;
  const lastLine  = bounds.last;

  // ── 2. Parse each import line in the block ────────────────────────────────
  // A comment inside the block (`// ktlint-disable no-wildcard-imports`) is
  // kept where it is: it splits the block into runs sorted separately, so the
  // comment keeps standing above the import it was written for.
  const parsed: ParsedImport[] = [];
  const separators: { afterIndex: number; text: string }[] = [];
  // A `/* … */` inside the block is copied verbatim, line by line. Without
  // the state, an interior line starting with neither `*` nor `//` was
  // dropped: the comment lost its `*/` and the rest of the FILE became a
  // comment, so the module stopped compiling.
  let inBlockComment = false;
  for (let i = firstLine; i <= lastLine; i++) {
    const trimmed = lines[i].trim();
    if (inBlockComment) {
      separators.push({ afterIndex: parsed.length, text: lines[i] });
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      separators.push({ afterIndex: parsed.length, text: lines[i] });
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue; // a commented out import is not an import
    }
    const m = RE_IMPORT_LINE.exec(lines[i]);
    if (!m) {
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) separators.push({ afterIndex: parsed.length, text: lines[i] });
      continue; // blank line — dropped
    }
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
    if (!removeUnused || imp.isWildcard || !imp.simpleName || isResolvedByConvention(imp.simpleName)) {
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

  // ── 5. Sort alphabetically by path, within each comment-separated run ────
  const byPath = (a: ParsedImport, b: ParsedImport) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const out: string[] = [];
  if (separators.length === 0) {
    kept.sort(byPath);
    out.push(...kept.map(i => i.fullText));
  } else {
    const keptSet = new Set(kept);
    let cursor = 0;
    const flush = (upTo: number) => {
      const run = parsed.slice(cursor, upTo).filter(i => keptSet.has(i)).sort(byPath);
      out.push(...run.map(i => i.fullText));
      cursor = upTo;
    };
    for (const sep of separators) {
      flush(sep.afterIndex);
      out.push(sep.text);
    }
    flush(parsed.length);
  }

  return {
    firstLine,
    lastLine,
    replacement: out.join('\n'),
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
