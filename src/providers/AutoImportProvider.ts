import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { buildAllowFilter } from '../util/testFilter';

const WORD_RE = /[A-Za-z_]\w*/;
const RE_IMPORT_LINE = /^\s*import\s+(?:static\s+)?[\w.*]+(?:\s+as\s+\w+)?\s*(?:\/\/.*)?$/;

// Kotlin / Java keywords and common builtins that will never be importable.
// Without this list, Ctrl+. on `val`, `if`, `it` etc. would trigger index lookups.
const KOTLIN_KEYWORDS = new Set([
  'abstract', 'actual', 'annotation', 'as', 'break', 'by', 'catch', 'class',
  'companion', 'const', 'constructor', 'continue', 'crossinline', 'data',
  'delegate', 'do', 'dynamic', 'else', 'enum', 'expect', 'external', 'false',
  'field', 'file', 'final', 'finally', 'for', 'fun', 'get', 'if', 'import',
  'in', 'infix', 'init', 'inline', 'inner', 'interface', 'internal', 'is',
  'it', 'lateinit', 'noinline', 'null', 'object', 'open', 'operator', 'out',
  'override', 'package', 'param', 'private', 'property', 'protected', 'public',
  'receiver', 'reified', 'return', 'sealed', 'set', 'setparam', 'super',
  'suspend', 'tailrec', 'this', 'throw', 'true', 'try', 'typealias', 'typeof',
  'val', 'var', 'vararg', 'when', 'where', 'while',
  // Common Kotlin std names that look like symbols but need no import
  'Unit', 'Any', 'Nothing', 'String', 'Int', 'Long', 'Double', 'Float',
  'Boolean', 'Byte', 'Short', 'Char', 'Array', 'List', 'Map', 'Set',
  'Pair', 'Triple', 'Sequence', 'Iterable', 'Collection', 'MutableList',
  'MutableMap', 'MutableSet', 'Comparable', 'Throwable', 'Exception',
  'println', 'print', 'require', 'check', 'error', 'TODO', 'also', 'let',
  'run', 'apply', 'with', 'repeat', 'takeIf', 'takeUnless',
]);

/**
 * Builds a TextEdit that inserts `import <fqn>` alphabetically in the existing
 * import block, or after the package line if no imports exist yet.
 */
export function insertImport(document: vscode.TextDocument, fqn: string): vscode.TextEdit {
  const text  = document.getText();
  const lines = text.split('\n');

  let firstImportLine = -1;
  let lastImportLine  = -1;
  for (let i = 0; i < lines.length; i++) {
    if (RE_IMPORT_LINE.test(lines[i])) {
      if (firstImportLine === -1) firstImportLine = i;
      lastImportLine = i;
    }
  }

  const newLine = `import ${fqn}`;

  if (firstImportLine === -1) {
    // No existing imports — insert after the package line (or at line 0)
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('package ')) { insertAt = i + 1; break; }
    }
    // Add a blank line separator when the next line is non-empty
    const prefix = insertAt > 0 && lines[insertAt]?.trim() !== '' ? '\n' : '';
    return vscode.TextEdit.insert(new vscode.Position(insertAt, 0), prefix + newLine + '\n');
  }

  // Insert alphabetically within the existing block
  for (let i = firstImportLine; i <= lastImportLine; i++) {
    const m = lines[i].match(/^\s*import\s+(?:static\s+)?([\w.*]+)/);
    if (m && fqn < m[1]) {
      return vscode.TextEdit.insert(new vscode.Position(i, 0), newLine + '\n');
    }
  }

  // Append after the last import line
  return vscode.TextEdit.insert(new vscode.Position(lastImportLine + 1, 0), newLine + '\n');
}

// Maximum suggestions shown to avoid overwhelming the user when a common
// short name (e.g. "Text") has dozens of overloads across multiple packages.
const MAX_CANDIDATES = 8;

export class AutoImportProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly index: SymbolIndex) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] | undefined {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('autoImport.enabled', true)) return undefined;

    // Skip automatic lightbulb triggers — only respond to explicit Ctrl+. invocations.
    // Without a compiler/JVM we have no unresolved-symbol diagnostics to tie the
    // action to, so we must rely on cursor-position scanning. Restricting to manual
    // triggers avoids cluttering every keystroke with spurious quick-fix suggestions.
    if (context.triggerKind === vscode.CodeActionTriggerKind.Automatic) return undefined;

    const wordRange = document.getWordRangeAtPosition(range.start, WORD_RE);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);

    // Skip Kotlin/Java keywords, single-letter loop variables, and ultra-short names
    // (e.g. `it`, `as`, `is`, `in`) that are never importable.
    if (word.length < 3 || KOTLIN_KEYWORDS.has(word)) return undefined;

    // Already resolved (exact import, same-package, or wildcard) — nothing to do.
    // This correctly handles `import androidx.compose.runtime.*` → `remember` is
    // resolved as wildcard priority, so we skip it.
    const resolution = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    if (resolution.priority !== 'none') return undefined;

    const allow = buildAllowFilter(document.uri.fsPath);
    const allCandidates = this.index.lookup(word).filter(e => allow(e.uri.path));
    if (allCandidates.length === 0) return undefined;

    // Prefer classes/composables/interfaces over raw functions to surface the most
    // actionable suggestions first in ambiguous cases (e.g. many overloads of `items`).
    const ranked = [...allCandidates].sort((a, b) => {
      const rank = (k: string) =>
        k === 'class' || k === 'dataClass' || k === 'sealedClass' || k === 'interface'
          ? 0
          : k === 'composable' ? 1
          : k === 'object' || k === 'annotation' ? 2
          : 3; // fun, val, var
      return rank(a.kind) - rank(b.kind);
    });

    const candidates = ranked.slice(0, MAX_CANDIDATES);

    return candidates.map((entry, i) => {
      const action = new vscode.CodeAction(
        `Add import '${entry.fqn}'`,
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.set(document.uri, [insertImport(document, entry.fqn)]);
      action.edit = edit;
      // isPreferred = true → VS Code applies it automatically with Ctrl+Shift+.
      action.isPreferred = candidates.length === 1 && i === 0;
      return action;
    });
  }
}
