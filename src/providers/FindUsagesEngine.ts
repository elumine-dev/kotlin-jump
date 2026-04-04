import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString } from '../util/textUtils';
import { Logger } from '../util/logger';

// ── Internal: wildcard import extraction ─────────────────────────────────────

/**
 * Extracts the package prefix of every wildcard import in `text`.
 * e.g. `import com.example.*` → `"com.example"`.
 */
function extractWildcardPrefixes(text: string): string[] {
  const prefixes: string[] = [];
  // \r? handles Windows CRLF files: after \n the next char is \r, not 'i'
  const re = /^\r?import\s+([\w.]+)\.\*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    prefixes.push(m[1]);
  }
  return prefixes;
}

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
    const candidates = decls.filter(d => fileCouldReference(docText, d, index));
    if (candidates.length === 1) {
      target = candidates[0];
    } else if (candidates.length > 1) {
      // Same-file tiebreak: when the search originates from the declaring file
      // (e.g. Find Usages on `clickStream` inside LoginViewModel.kt), and both
      // LoginViewModel.clickStream and NavigationViewModelDelegate.clickStream
      // are in the same package, prefer the one declared in this exact file.
      const sameFile = candidates.filter(d => d.uri.toString() === document.uri.toString());
      if (sameFile.length === 1) target = sameFile[0];
    }
  }

  return target;
}

export async function scanForUsages(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
  log?: Logger,
): Promise<UsageResult[]> {
  const decls = index.lookup(word);
  if (decls.length === 0) return [];

  const target = resolveSearchTarget(word, document, index);

  // ── Private symbol: only the declaring file can reference it ─────────────
  // A `private val/var/fun` is invisible outside its declaring file. Scanning
  // other files would produce false positives when those files happen to have
  // their own same-named private member (common pattern: `private val clickStream`
  // repeated across multiple ViewModels in the same package).
  let effectiveUris = uriStrings;
  if (target?.isPrivate) {
    effectiveUris = uriStrings.filter(u => u === target.uri.toString());
    log?.info(`[findUsages] "${word}" is private → restricted to declaring file only (was ${uriStrings.length} files)`);
  } else {
    const targetDesc = target ? `${target.fqn}${target.isPrivate ? ' (private)' : ''}` : 'ambiguous';
    log?.info(`[findUsages] "${word}" target=${targetDesc} — scanning up to ${uriStrings.length} files`);
  }

  const maxReferences = vscode.workspace.getConfiguration('kotlinJump').get<number>('maxReferences', 500);
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: UsageResult[] = [];
  const skipped: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < effectiveUris.length) {
      if (token.isCancellationRequested) return;
      if (results.length >= maxReferences) return;
      const uriStr = effectiveUris[cursor++];
      const uri = vscode.Uri.parse(uriStr);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text  = Buffer.from(bytes).toString('utf8');

        if (!text.includes(word)) continue;
        if (target && !fileCouldReference(text, target, index)) {
          skipped.push(uriStr);
          continue;
        }

        const fileHitsBefore = results.length;
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
        const hitsInFile = results.length - fileHitsBefore;
        if (hitsInFile > 0 && log) {
          const name = uri.path.split('/').pop() ?? uri.path;
          log.info(`[findUsages]   ${name}: ${hitsInFile} hit${hitsInFile === 1 ? '' : 's'}`);
        }
      } catch { /* skip unreadable */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (log) {
    const fileCount = results.length === 0 ? 0 : new Set(results.map(r => r.uriString)).size;
    log.info(`[findUsages] "${word}" → ${results.length} total result${results.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`);
    if (skipped.length > 0) {
      log.info(`[findUsages]   skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} (fileCouldReference=false): ${skipped.map(u => u.split('/').pop()).join(', ')}`);
    }
  }

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
 *
 * When `index` is provided, the wildcard check is tightened: if another
 * wildcard import in the file covers a symbol with the same simple name from
 * a different package, the match is considered ambiguous and returns false.
 */
export function fileCouldReference(text: string, target: SymbolEntry, index?: SymbolIndex): boolean {
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
  if (pkg && importedExactly(text, `${pkg}.*`)) {
    // With an index we can check whether another wildcard in this file also exports
    // a symbol with the same simple name, which would make the reference ambiguous.
    // Only applies to top-level symbols (depth === 0): wildcard imports bring package-level
    // declarations into scope, not class members — so member symbols are never ambiguous
    // via wildcards and should not be penalised by a competing top-level function name.
    if (index && target.depth === 0) {
      const hasCompeting = extractWildcardPrefixes(text).some(
        prefix => prefix !== pkg && index.lookupFqn(`${prefix}.${target.name}`) !== undefined,
      );
      if (hasCompeting) return false;
    }
    return true;
  }
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
