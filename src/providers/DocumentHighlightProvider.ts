import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isInsideCommentOrString } from '../util/textUtils';

const WORD_RE = /[A-Za-z_]\w*/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class KotlinDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.DocumentHighlight[] | undefined {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);
    if (!word) return undefined;

    const text  = document.getText();
    const lines = text.split('\n');

    // Collect declaration lines for this symbol within this file (→ Write kind)
    const fileSymbols = this.index.getFileSymbols(document.uri.toString());
    const declarationLines = new Set<number>(
      fileSymbols.filter(s => s.name === word).map(s => s.line),
    );

    const wordRe     = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
    const highlights: vscode.DocumentHighlight[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(word)) continue;

      // Skip import lines — they are not "usages" in the editor sense
      if (line.trimStart().startsWith('import ')) continue;

      wordRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(line)) !== null) {
        if (isInsideCommentOrString(line, m.index)) continue;

        const kind = declarationLines.has(i)
          ? vscode.DocumentHighlightKind.Write
          : vscode.DocumentHighlightKind.Read;

        highlights.push(new vscode.DocumentHighlight(
          new vscode.Range(i, m.index, i, m.index + word.length),
          kind,
        ));
      }
    }

    return highlights.length > 0 ? highlights : undefined;
  }
}
