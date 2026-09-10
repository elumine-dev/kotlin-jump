/**
 * Server-side file scanning and usage search — no LSP connection dependency.
 * Extracted here so tests can import without triggering createConnection().
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { Location, Position as LspPosition, Range as LspRange } from 'vscode-languageserver/node';

import { SymbolIndex } from '../indexer/SymbolIndex';
import { parse as parseKotlin } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { escapeRegex } from '../providers/FindUsagesEngine';
import { isInsideCommentOrString } from '../util/textUtils';
import { uriToPath, pathToUri, INDEXABLE_RE } from './utils';

// ── Directories skipped during workspace scan ─────────────────────────────────

/** Above this, the scan stops: an editor launched from `~` must not index a home directory. */
export const MAX_SCANNED_FILES = 20_000;

export const SKIP_DIRS = new Set([
  'build', '.gradle', '.git', 'node_modules', '.idea', 'out', 'tmp',
]);

// ── Index a single file ───────────────────────────────────────────────────────

export async function indexFile(
  fsPath: string,
  index: SymbolIndex,
  readFile: (p: string) => Promise<string> = p => fs.readFile(p, 'utf8'),
): Promise<void> {
  if (!INDEXABLE_RE.test(fsPath)) return; // saving a README is not an index update
  try {
    const text   = await readFile(fsPath);
    const uri    = pathToUri(fsPath);
    const parsed = fsPath.endsWith('.java')
      ? parseJava(uri, text)
      : parseKotlin(uri, text);
    index.add(parsed);
  } catch {
    // skip unreadable files
  }
}

// ── Recursive workspace scan ──────────────────────────────────────────────────

export async function scanWorkspace(
  root: string,
  index: SymbolIndex,
  max: number = MAX_SCANNED_FILES,
): Promise<void> {
  const entries: string[] = [];

  const visited = new Set<string>();
  async function walk(dir: string) {
    let real: string;
    try { real = await fs.realpath(dir); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);

    let children: string[];
    try { children = await fs.readdir(dir); } catch { return; }
    await Promise.all(children.map(async name => {
      if (SKIP_DIRS.has(name)) return;
      if (name.startsWith('.')) return;           // .venv, .cache, dotfiles
      if (entries.length >= max) return;   // cheap skip, saves a pointless lstat
      const full = path.join(dir, name);
      let stat;
      try { stat = await fs.lstat(full); } catch { return; }
      // A symlink inside the project used to walk the scanner straight out of
      // the root, indexing whatever it pointed at.
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        await walk(full);
      } else if (INDEXABLE_RE.test(name)) {
        // Checked again here, with nothing awaited between the test and the
        // push. The check above runs before `lstat`, so every child of every
        // directory had already passed it before the first one pushed: asking
        // for one file indexed 360 of them.
        if (entries.length >= max) return;
        entries.push(full);
      }
    }));
  }

  await walk(root);

  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      await indexFile(entries[cursor++], index);
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  index.finalize();
}

// ── Find usages (reads files via injected reader — testable) ─────────────────

export async function findUsagesInWorkspace(
  word: string,
  index: SymbolIndex,
  token: { isCancellationRequested: boolean },
  readFile: (p: string) => Promise<string> = p => fs.readFile(p, 'utf8'),
): Promise<Location[]> {
  if (index.lookup(word).length === 0) return [];

  const uriStrings = index.fileUriStrings();
  const wordRe     = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: Location[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested || results.length >= 500) return;
      const uriStr = uriStrings[cursor++];
      const fsPath = uriToPath(uriStr);
      try {
        const text = await readFile(fsPath);
        if (!text.includes(word)) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= 500) break;
          const trimmed = lines[i].trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          wordRe.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = wordRe.exec(lines[i])) !== null) {
            if (results.length >= 500) { wordRe.lastIndex = 0; break; }
            if (!isInsideCommentOrString(lines[i], m.index)) {
              results.push(Location.create(
                uriStr,
                LspRange.create(
                  LspPosition.create(i, m.index),
                  LspPosition.create(i, m.index + word.length),
                ),
              ));
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  return results;
}
