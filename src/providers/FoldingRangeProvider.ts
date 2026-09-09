import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { bodyEndLine } from '../util/symbolRanges';
import { symbolsForDocument } from '../util/liveSymbols';
import { organizeImports } from './OrganizeImportsProvider';
import { capMap, OPEN_FILE_CACHE_LIMIT } from '../util/boundedCache';
import { fingerprint } from '../util/boundedCache';

export class KotlinFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly index: SymbolIndex) {}

  // `dirty` belongs in the key: saving does not bump document.version, and the
  // two branches below do not read the same source. So does the length: a
  // reopened document restarts at version 1, so uri plus version can name two
  // different texts and the folds of the previous session were replayed.
  private cache = new Map<string, { version: number; dirty: boolean; fp: number; ranges: vscode.FoldingRange[] }>();


  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const key = document.uri.toString();
    const text = document.getText();
    const fp = fingerprint(text);
    const cached = this.cache.get(key);
    if (cached
      && cached.version === document.version
      && cached.dirty === document.isDirty
      && cached.fp === fp) {
      return cached.ranges;
    }

    const ranges: vscode.FoldingRange[] = [];
    const lastLine = document.lineCount - 1;

    // 1. Import block
    const importResult = organizeImports(document.getText(), { removeUnused: false });
    if (importResult && importResult.lastLine > importResult.firstLine) {
      ranges.push(new vscode.FoldingRange(
        importResult.firstLine, importResult.lastLine, vscode.FoldingRangeKind.Imports,
      ));
    }

    // 2. KDoc block comments /** ... */
    // Track raw string state (""") to avoid detecting KDoc inside raw strings.
    // Each """ on a line toggles inRawString; skip KDoc detection for lines that
    // are inside a raw string (wasInRawString) or that open/close one (inRawString).
    let inBlock = false;
    let blockStart = -1;
    let inRawString = false;
    for (let i = 0; i <= lastLine; i++) {
      const lineText = document.lineAt(i).text;
      const wasInRawString = inRawString;
      let pos = 0;
      while (pos <= lineText.length - 3) {
        if (lineText[pos] === '"' && lineText[pos + 1] === '"' && lineText[pos + 2] === '"') {
          inRawString = !inRawString;
          pos += 3;
        } else {
          pos++;
        }
      }
      if (wasInRawString || inRawString) continue;

      const line = lineText.trimStart();
      if (!inBlock && line.startsWith('/**')) { inBlock = true; blockStart = i; }
      if (inBlock && line.includes('*/')) {
        if (i > blockStart) {
          ranges.push(new vscode.FoldingRange(blockStart, i, vscode.FoldingRangeKind.Comment));
        }
        inBlock = false;
      }
    }

    // 3. Symbol blocks: the real `}` of each body, so a folded member does
    // not swallow the next member's KDoc or the class's closing brace.
    // Same reason as the outline: while the buffer is dirty the indexed lines
    // are those of the saved text, and the folds landed on the wrong lines.
    const entries = symbolsForDocument(this.index, document);
    const lines = document.getText().split('\n');
    for (let i = 0; i < entries.length; i++) {
      const endLine = bodyEndLine(lines, entries, i, lastLine);
      if (endLine > entries[i].line) {
        ranges.push(new vscode.FoldingRange(entries[i].line, endLine, vscode.FoldingRangeKind.Region));
      }
    }

    const result = ranges.length > 5000 ? ranges.slice(0, 5000) : ranges;
    this.cache.set(key, { version: document.version, dirty: document.isDirty, fp, ranges: result });
    capMap(this.cache, OPEN_FILE_CACHE_LIMIT);
    return result;
  }
}
