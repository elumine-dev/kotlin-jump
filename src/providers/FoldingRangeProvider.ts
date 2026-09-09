import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { bodyEndLine } from '../util/symbolRanges';
import { symbolsForDocument } from '../util/liveSymbols';
import { organizeImports } from './OrganizeImportsProvider';
import { capMap, fingerprint, sameDocument, OPEN_FILE_CACHE_LIMIT } from '../util/boundedCache';

export class KotlinFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly index: SymbolIndex) {}

  // `dirty` belongs in the key: saving does not bump document.version, and the
  // two branches below do not read the same source. So does the length: a
  // reopened document restarts at version 1, so uri plus version can name two
  // different texts and the folds of the previous session were replayed.
  private cache = new Map<string, { version: number; dirty: boolean; fp: number; doc: vscode.TextDocument; ranges: vscode.FoldingRange[] }>();


  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached
      && cached.version === document.version
      && cached.dirty === document.isDirty
      // Same document OBJECT at the same version is necessarily the same text:
      // VS Code bumps the version on every change. Comparing the reference
      // costs nothing, and the fingerprint is only paid when the object
      // differs, which is exactly the reopened file the fingerprint is for.
      && sameDocument(cached, document, () => document.getText())) {
      return cached.ranges;
    }
    const text = document.getText();
    const fp = fingerprint(text);

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
    // One chevron per line: a primary constructor property sits on its class's
    // own line, and its range stopped at the first member instead of the
    // closing brace, so folding the class folded a fragment of it. The
    // declaration comes first in source order, so the first fold is the right
    // one to keep.
    const foldedLines = new Set<number>();
    for (let i = 0; i < entries.length; i++) {
      const startLine = entries[i].line;
      if (foldedLines.has(startLine)) continue;
      const endLine = bodyEndLine(lines, entries, i, lastLine);
      if (endLine > startLine) {
        foldedLines.add(startLine);
        ranges.push(new vscode.FoldingRange(startLine, endLine, vscode.FoldingRangeKind.Region));
      }
    }

    const result = ranges.length > 5000 ? ranges.slice(0, 5000) : ranges;
    this.cache.set(key, { version: document.version, dirty: document.isDirty, fp, doc: document, ranges: result });
    capMap(this.cache, OPEN_FILE_CACHE_LIMIT);
    return result;
  }
}
