import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { rangeEndLine } from '../util/symbolRanges';
import { organizeImports } from './OrganizeImportsProvider';

export class KotlinFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly index: SymbolIndex) {}

  private cache = new Map<string, { version: number; ranges: vscode.FoldingRange[] }>();

  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) return cached.ranges;

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

    // 3. Symbol blocks
    const entries = this.index.getFileSymbols(key);
    for (let i = 0; i < entries.length; i++) {
      const endLine = rangeEndLine(entries, i, lastLine);
      if (endLine > entries[i].line) {
        ranges.push(new vscode.FoldingRange(entries[i].line, endLine, vscode.FoldingRangeKind.Region));
      }
    }

    const result = ranges.length > 5000 ? ranges.slice(0, 5000) : ranges;
    this.cache.set(key, { version: document.version, ranges: result });
    return result;
  }
}
