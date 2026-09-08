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
  const uriStr = document.uri.toString();
  if (!document.isDirty) {
    return index.getFileSymbols(uriStr).filter(e => e.line < document.lineCount);
  }
  // Outline, breadcrumbs and folding are all asked for the same document at
  // the same version, one after the other. Without this the file was parsed
  // once per feature, three times per keystroke on a large file.
  if (_memo && _memo.uri === uriStr && _memo.version === document.version) return _memo.entries;

  const text = document.getText();
  const scratch = new SymbolIndex();
  // fileOnly: the caller reads getFileSymbols and nothing else.
  scratch.add(document.languageId === 'java' ? parseJava(uriStr, text) : parse(uriStr, text), undefined, true);
  const entries = scratch.getFileSymbols(uriStr).filter(e => e.line < document.lineCount);
  _memo = { uri: uriStr, version: document.version, entries };
  return entries;
}

/** One entry is enough: the callers run back to back on the same document. */
let _memo: { uri: string; version: number; entries: SymbolEntry[] } | undefined;

/** Drops the memo. Exported for tests. */
export function forgetLiveSymbols(): void {
  _memo = undefined;
}
