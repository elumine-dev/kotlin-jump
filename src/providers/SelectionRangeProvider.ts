import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { rangeEndLine } from '../util/symbolRanges';

export class KotlinSelectionRangeProvider implements vscode.SelectionRangeProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideSelectionRanges(
    document: vscode.TextDocument,
    positions: vscode.Position[],
    _token: vscode.CancellationToken,
  ): vscode.SelectionRange[] {
    const entries = this.index.getFileSymbols(document.uri.toString());
    const lastLine = document.lineCount - 1;
    const fileRange = new vscode.Range(new vscode.Position(0, 0), document.lineAt(lastLine).range.end);
    const fileSelRange = new vscode.SelectionRange(fileRange);

    return positions.map(position => {
      const containing = entries
        .map((e, i) => ({ e, end: rangeEndLine(entries, i, lastLine) }))
        .filter(({ e, end }) => e.line <= position.line && position.line <= end)
        .sort((a, b) => a.e.depth - b.e.depth); // shallowest first

      if (containing.length === 0) return fileSelRange;

      // Build SelectionRange chain from outermost (shallowest) to innermost (deepest).
      // Each symbol wraps the previous as its parent — VS Code walks .parent to expand.
      let current: vscode.SelectionRange = fileSelRange;
      for (const { e, end } of containing) {
        const symRange = new vscode.Range(
          new vscode.Position(e.line, 0),
          document.lineAt(end).range.end,
        );
        current = new vscode.SelectionRange(symRange, current);
      }
      return current;
    });
  }
}
