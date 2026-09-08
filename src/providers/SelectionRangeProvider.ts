import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { bodyEndLine } from '../util/symbolRanges';
import { symbolsForDocument } from '../util/liveSymbols';

export class KotlinSelectionRangeProvider implements vscode.SelectionRangeProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideSelectionRanges(
    document: vscode.TextDocument,
    positions: vscode.Position[],
    _token: vscode.CancellationToken,
  ): vscode.SelectionRange[] {
    // On a dirty buffer the disk index still holds the symbols of the saved
    // text, so Expand Selection jumped to the wrong bounds, or straight to
    // the whole file when the edit had shifted every declaration.
    const entries = symbolsForDocument(this.index, document);
    const lastLine = document.lineCount - 1;
    const lines = document.getText().split('\n');
    const fileRange = new vscode.Range(new vscode.Position(0, 0), document.lineAt(lastLine).range.end);
    const fileSelRange = new vscode.SelectionRange(fileRange);

    return positions.map(position => {
      const containing = entries
        .map((e, i) => ({ e, end: bodyEndLine(lines, entries, i, lastLine) }))
        .filter(({ e, end }) => e.line <= position.line && position.line <= end)
        .sort((a, b) => a.e.depth - b.e.depth); // shallowest first

      if (containing.length === 0) return fileSelRange;

      // Build SelectionRange chain from outermost (shallowest) to innermost (deepest).
      // Each symbol wraps the previous as its parent — VS Code walks .parent to expand.
      let current: vscode.SelectionRange = fileSelRange;
      for (const { e, end: rawEnd } of containing) {
        // rangeEndLine stops one line before the next symbol, which is the
        // next declaration's KDoc and annotations: walk back over them.
        let end = rawEnd;
        while (end > e.line) {
          const t = document.lineAt(end).text.trim();
          if (t === '' || t.startsWith('@') || t.startsWith('/**') || t.startsWith('*') || t.startsWith('//')) end--;
          else break;
        }
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
