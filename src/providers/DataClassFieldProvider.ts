import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';

const TOOLTIP = new vscode.MarkdownString(
  'Body properties of a `data class` are **not** part of `equals()`, '
  + '`hashCode()`, `toString()`, or `copy()` — only primary constructor '
  + 'parameters are. Two instances differing only in this field compare '
  + 'equal, and `copy()` resets it to its initializer. Move it to the '
  + 'constructor if it belongs to the value.',
);

/**
 * Flags `val`/`var` declared in a data class BODY, a classic silent trap:
 *
 *   data class User(val id: Int) {
 *       val cache = emptyList<String>()   ⚠ not in equals/copy
 *   }
 *
 * Relies on the parser's isPrimaryCtorParam flag: constructor properties
 * and body properties share the same depth in the index, the flag is the
 * only thing telling them apart. Toggle with
 * `kotlinJump.dataClassFieldWarnings`.
 */
export class DataClassFieldProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onChange.event;

  constructor(private readonly index: SymbolIndex) {}

  fireChange(): void { this._onChange.fire(); }
  dispose(): void { this._onChange.dispose(); }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('dataClassFieldWarnings', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const symbols = this.index.getFileSymbols(document.uri.toString());
    const hints: vscode.InlayHint[] = [];

    for (const field of bodyFieldsOfDataClasses(symbols)) {
      if (field.line < range.start.line || field.line > range.end.line) continue;
      const hint = new vscode.InlayHint(
        new vscode.Position(field.line, field.character + field.name.length),
        '⚠ not in equals/copy',
        vscode.InlayHintKind.Parameter,
      );
      hint.paddingLeft = true;
      hint.tooltip = TOOLTIP;
      hints.push(hint);
    }
    return hints;
  }
}

const CLASS_LIKE = new Set(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum', 'annotation']);

/**
 * val/var entries sitting directly in a data class body (excluded from the
 * generated members). Exported for tests. Symbols are in file order; a
 * field belongs to the LAST class-like entry above it at depth - 1 —
 * companion object members sit one level deeper and are skipped naturally.
 */
export function bodyFieldsOfDataClasses(symbols: SymbolEntry[]): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  // Stack of enclosing class-like entries, mirroring declaration nesting.
  const stack: SymbolEntry[] = [];
  for (const s of symbols) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= s.depth) stack.pop();
    if (CLASS_LIKE.has(s.kind)) { stack.push(s); continue; }
    if (s.kind !== 'val' && s.kind !== 'var') continue;
    if (s.isPrimaryCtorParam || s.isConst) continue;
    const enclosing = stack[stack.length - 1];
    if (enclosing?.kind === 'dataClass' && s.depth === enclosing.depth + 1) out.push(s);
  }
  return out;
}
