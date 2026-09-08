import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { computeTripleStringMask, computeBlockCommentMask, inTripleStringMask } from './SemanticTokensProvider';

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
    // The per-line check cannot see a `/* … */` or a `"""` opened above: the
    // `@param name` of a KDoc and the SQL of a Room `@Query` were highlighted.
    const tripleMask  = computeTripleStringMask(lines);
    const commentMask = computeBlockCommentMask(lines, tripleMask);

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
        if (inTripleStringMask(commentMask, i, m.index)) continue;
        if (inTripleStringMask(tripleMask, i, m.index) && !(m.index >= 1 && line[m.index - 1] === '$')) continue;
        if (isInsideCommentOrString(line, m.index)) {
          // `"Hello $name"` and `"${name}"` are code, as Find Usages already counts them.
          const shortInterp = m.index >= 1 && line[m.index - 1] === '$' && !(m.index >= 2 && line[m.index - 2] === '\\');
          if (!shortInterp && !isInsideStringInterpolation(line, m.index)) continue;
        }

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
