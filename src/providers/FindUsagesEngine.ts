import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';

const CONCURRENCY = 20;

export const DEFAULT_TEST_SEGMENTS: string[] = [];

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
export async function scanForUsages(
  word: string,
  document: vscode.TextDocument,
  index: SymbolIndex,
  uriStrings: string[],
  token: vscode.CancellationToken,
): Promise<UsageResult[]> {
  const decls = index.lookup(word);
  if (decls.length === 0) return [];

  // Resolve the specific FQN from the current document's import context.
  // If wildcard imports remain ambiguous, avoid narrowing to the wrong target.
  let target: SymbolEntry | undefined;
  const resolved = resolveBest(word, document, fqn => index.lookupFqn(fqn));
  if (resolved.matches.length === 1) target = resolved.matches[0];
  if (!target && decls.length === 1) target = decls[0];

  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: UsageResult[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested) return;
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
    // Check only the header (package declaration is always in the first ~512 chars)
    // Use a word-boundary suffix to avoid matching sub-packages (app vs app.feature)
    if (new RegExp(`\\bpackage\\s+${escapeRegex(pkg)}(?:[\\s;]|$)`).test(text.slice(0, 512))) return true;
  }
  if (text.includes(`import ${fqn}`)) return true;
  // For member FQNs (pkg.Class.method), also check import of the containing class
  const lastDot = fqn.lastIndexOf('.');
  if (lastDot > 0) {
    const parentFqn = fqn.substring(0, lastDot);
    if (text.includes(`import ${parentFqn}`)) return true;
  }
  if (pkg && text.includes(`import ${pkg}.*`)) return true;
  return false;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
