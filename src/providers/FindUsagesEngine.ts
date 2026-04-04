import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString } from '../util/textUtils';

import picomatch from 'picomatch';

const CONCURRENCY = 20;

export const DEFAULT_TEST_SEGMENTS: string[] = [];

// ── Shared exclude filter (used by ReferenceProvider + CallHierarchyProvider) ──
let _matcherKey = '';
let _matchers: ((path: string) => boolean)[] = [];

export function getExcludeMatchers(): ((path: string) => boolean)[] {
  const patterns = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<string[]>('excludeFromReferences', []);
  const key = patterns.join('\0');
  if (key !== _matcherKey) {
    _matcherKey = key;
    _matchers = patterns.map(p => picomatch(p, { dot: true }));
  }
  return _matchers;
}

export function isExcluded(uriString: string): boolean {
  const matchers = getExcludeMatchers();
  if (matchers.length === 0) return false;
  return matchers.some(m => m(vscode.Uri.parse(uriString).path));
}

export interface UsageResult {
  uri: vscode.Uri;
  uriString: string;
  line: number;      // 0-based
  character: number; // 0-based
  lineText: string;  // raw line (not trimmed)
}

/**
 * Scans `uriStrings` for usages of `word`, disambiguating via FQN when possible.
 *
 * Callers are responsible for pre-filtering `uriStrings` (e.g. applying
 * kotlinJump.excludeFromReferences globs) before passing them in.
 */
/**
 * Determines which specific declaration of `word` the given document is most
 * likely referencing. Returns `undefined` when ambiguous.
 *
 * Resolution priority:
 *   1. Exact/wildcard FQN import match via resolveBest
 *   2. Only one declaration exists globally
 *   3. Parent-class visibility: for members (enum entries, companion consts)
 *      whose simple name isn't imported directly, check which declaration's
 *      enclosing class is imported / in the same package as the caller document.
 */
export function resolveSearchTarget(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
): SymbolEntry | undefined {
  const decls = index.lookup(word);
  if (decls.length === 0) return undefined;

  let target: SymbolEntry | undefined;
  const resolved = resolveBest(word, document, fqn => index.lookupFqn(fqn));
  if (resolved.matches.length === 1) target = resolved.matches[0];
  if (!target && decls.length === 1) target = decls[0];

  // For member symbols (enum entries, companion constants, etc.) whose simple
  // name isn't directly imported, the word-level resolveBest above fails.
  // Disambiguate by checking which declaration's parent class is visible in
  // the caller document (same package, explicit import, or wildcard import).
  if (!target && decls.length > 1) {
    const docText = document.getText();
    const candidates = decls.filter(d => fileCouldReference(docText, d));
    if (candidates.length === 1) target = candidates[0];
  }

  return target;
}

export async function scanForUsages(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
): Promise<UsageResult[]> {
  const decls = index.lookup(word);
  if (decls.length === 0) return [];

  const target = resolveSearchTarget(word, document, index);

  const maxReferences = vscode.workspace.getConfiguration('kotlinJump').get<number>('maxReferences', 500);
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: UsageResult[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested) return;
      if (results.length >= maxReferences) return;
      const uriStr = uriStrings[cursor++];
      const uri = vscode.Uri.parse(uriStr);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text  = Buffer.from(bytes).toString('utf8');

        if (!text.includes(word)) continue;
        if (target && !fileCouldReference(text, target)) continue;

        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trimStart();
          if (
            trimmed.startsWith('import ') ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('/*')
          ) continue;

          wordRe.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = wordRe.exec(lines[i])) !== null) {
            if (results.length >= maxReferences) break;
            if (!isInsideCommentOrString(lines[i], m.index)) {
              results.push({ uri, uriString: uriStr, line: i, character: m.index, lineText: lines[i] });
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

/**
 * Scans `uriStrings` for import lines containing `word`.
 * Used by RenameProvider to update import statements, which scanForUsages skips.
 */
export async function scanImports(
  word: string,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
): Promise<UsageResult[]> {
  if (index.lookup(word).length === 0) return [];

  const maxReferences = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<number>('maxReferences', 500);
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: UsageResult[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested) return;
      if (results.length >= maxReferences) return;
      const uriStr = uriStrings[cursor++];
      const uri = vscode.Uri.parse(uriStr);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text  = Buffer.from(bytes).toString('utf8');
        if (!text.includes(word)) continue;

        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxReferences) break;
          if (!lines[i].trimStart().startsWith('import ')) continue;

          wordRe.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = wordRe.exec(lines[i])) !== null) {
            if (results.length >= maxReferences) break;
            results.push({ uri, uriString: uriStr, line: i, character: m.index, lineText: lines[i] });
          }
        }
      } catch { /* skip unreadable */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

/**
 * Returns true if a file could plausibly reference the target symbol.
 * Checks: same package, explicit FQN import, or wildcard package import.
 */
export function fileCouldReference(text: string, target: SymbolEntry): boolean {
  const { fqn, packageName: pkg } = target;
  if (pkg) {
    // Anchor to start of line (multiline ^) so a `// package foo` comment never matches.
    // Check only the first ~512 chars — package declaration is always in the header.
    if (new RegExp(`^\\s*package\\s+${escapeRegex(pkg)}(?:\\s|;|$)`, 'm').test(text.slice(0, 512))) return true;
  }
  if (importedExactly(text, fqn)) return true;
  // For member FQNs (pkg.Class.method), also check import of the containing class
  const lastDot = fqn.lastIndexOf('.');
  if (lastDot > 0) {
    const parentFqn = fqn.substring(0, lastDot);
    if (importedExactly(text, parentFqn)) return true;
  }
  if (pkg && importedExactly(text, `${pkg}.*`)) return true;
  return false;
}

/**
 * True when `text` contains `import <path>` where the path is not a prefix of
 * a longer identifier (e.g. `import pkg.FooBarExtended` must NOT match `pkg.FooBar`).
 */
function importedExactly(text: string, importPath: string): boolean {
  const needle = `import ${importPath}`;
  let start = 0;
  while (true) {
    const idx = text.indexOf(needle, start);
    if (idx === -1) return false;
    const after = text[idx + needle.length];
    // Valid end: end-of-string, whitespace, semicolon — but NOT a word/dot character
    if (after === undefined || (after !== '.' && !/\w/.test(after))) return true;
    start = idx + 1;
  }
}

export { isInsideCommentOrString } from '../util/textUtils';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
