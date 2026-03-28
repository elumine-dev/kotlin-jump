import * as vscode from 'vscode';
import picomatch from 'picomatch';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolve as resolveImports } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;
const CONCURRENCY = 20;

// ── Picomatch cache ───────────────────────────────────────────────────────────
// Patterns are compiled once and reused until the config changes.
// Key = patterns joined with \0 (cheap sentinel, one allocation on change only).
let _matcherKey = '';
let _matchers: ((path: string) => boolean)[] = [];

function getExcludeMatchers(): ((path: string) => boolean)[] {
  const patterns = vscode.workspace
    .getConfiguration('kotlinNav')
    .get<string[]>('excludeFromReferences', []);

  const key = patterns.join('\0');
  if (key !== _matcherKey) {
    _matcherKey = key;
    // dot:true — required for patterns like **/.gradle/**, **/.idea/**
    _matchers = patterns.map(p => picomatch(p, { dot: true }));
  }
  return _matchers;
}

// Filters before any I/O — pure CPU work, eliminates files from the scan list.
function isExcluded(uriString: string): boolean {
  const matchers = getExcludeMatchers();
  if (matchers.length === 0) return false;
  // vscode.Uri.path always uses forward slashes — correct for picomatch (POSIX semantics)
  const path = vscode.Uri.parse(uriString).path;
  return matchers.some(m => m(path));
}

export class KotlinReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    const decls = this.index.lookup(word);
    if (decls.length === 0) return null;

    // Resolve the specific FQN from the current document's import context.
    // This disambiguates same-name symbols from different packages
    // (e.g. two different ConnectivityState classes in the same project).
    let targetEntry: SymbolEntry | undefined;
    for (const fqn of resolveImports(word, document)) {
      const entry = this.index.lookupFqn(fqn);
      if (entry) { targetEntry = entry; break; }
    }
    if (!targetEntry && decls.length === 1) targetEntry = decls[0];

    // Declaration positions — used to optionally exclude them from results
    const declKeys = new Set(
      (targetEntry ? [targetEntry] : decls).map(e => `${e.uri.toString()}:${e.line}:${e.character}`)
    );

    const results: vscode.Location[] = [];
    const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');

    // ── Pre-filter URI list (before any I/O) ─────────────────────────────────
    // 1. Apply kotlinNav.excludeFromReferences glob patterns (picomatch, pre-compiled)
    // 2. Package/import filter narrows to files that could actually reference the symbol
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));

    let cursor = 0;
    const worker = async () => {
      while (cursor < uriStrings.length) {
        if (token.isCancellationRequested) return;
        const uriStr = uriStrings[cursor++];
        const uri = vscode.Uri.parse(uriStr);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(bytes).toString('utf8');

          // Quick pre-filter: skip files that don't mention the symbol at all
          if (!text.includes(word)) continue;

          // When we have a specific target FQN, skip files that can't possibly
          // reference it (wrong package and no matching import)
          if (targetEntry && !fileCouldReference(text, targetEntry)) continue;

          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trimStart();

            // Skip import lines, single-line comments, and block comment lines
            if (
              trimmed.startsWith('import ') ||
              trimmed.startsWith('//') ||
              trimmed.startsWith('*') ||
              trimmed.startsWith('/*')
            ) continue;

            wordRe.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = wordRe.exec(lines[i])) !== null) {
              if (!context.includeDeclaration && declKeys.has(`${uriStr}:${i}:${m.index}`)) continue;
              results.push(new vscode.Location(uri, new vscode.Position(i, m.index)));
            }
          }
        } catch { /* skip unreadable files */ }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return results.length > 0 ? results : null;
  }
}

/**
 * Returns true if a file could plausibly reference a symbol from the given entry.
 * Checks three conditions (any one is sufficient):
 *  1. Same package — no import required
 *  2. Explicit import of the FQN
 *  3. Wildcard import of the symbol's package
 */
function fileCouldReference(text: string, target: SymbolEntry): boolean {
  const { fqn, packageName: pkg } = target;

  // 1. Same package (exact match, not a sub-package)
  if (pkg) {
    const header = text.slice(0, 512);
    if (new RegExp(`\\bpackage\\s+${escapeRegex(pkg)}(?:[\\s;]|$)`).test(header)) return true;
  }

  // 2. Explicit import of the FQN (Kotlin or Java — semicolon optional)
  if (text.includes(`import ${fqn}`)) return true;

  // 3. Wildcard import of the package
  if (pkg && text.includes(`import ${pkg}.*`)) return true;

  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
