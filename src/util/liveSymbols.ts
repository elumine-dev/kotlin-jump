import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';

/**
 * Symbols for a document, taken from the live buffer while it is dirty.
 *
 * The index follows the file on disk: it is refreshed by the file watcher,
 * 150 ms after a save. Between a keystroke and that save the indexed lines
 * belong to an older text, so anything built on them lands on the wrong
 * lines. Structure aware features must go through here rather than read
 * `index.getFileSymbols` directly.
 */
export function symbolsForDocument(index: SymbolIndex, document: vscode.TextDocument): SymbolEntry[] {
  if (!document.isDirty) {
    return index.getFileSymbols(document.uri.toString()).filter(e => e.line < document.lineCount);
  }
  const scratch = new SymbolIndex();
  const uriStr = document.uri.toString();
  const text = document.getText();
  scratch.add(document.languageId === 'java' ? parseJava(uriStr, text) : parse(uriStr, text));
  return scratch.getFileSymbols(uriStr).filter(e => e.line < document.lineCount);
}
