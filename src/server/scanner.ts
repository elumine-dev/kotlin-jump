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
import { uriToPath, pathToUri } from './utils';

// ── Directories skipped during workspace scan ─────────────────────────────────

export const SKIP_DIRS = new Set([
  'build', '.gradle', '.git', 'node_modules', '.idea', 'out', 'tmp',
]);

// ── Index a single file ───────────────────────────────────────────────────────

export async function indexFile(
  fsPath: string,
  index: SymbolIndex,
  readFile: (p: string) => Promise<string> = p => fs.readFile(p, 'utf8'),
): Promise<void> {
  try {
    const text   = await readFile(fsPath);
    const uri    = pathToUri(fsPath);
    const parsed = fsPath.endsWith('.java') ? parseJava(uri, text) : parseKotlin(uri, text);
    index.add(parsed);
  } catch {
    // skip unreadable files
  }
}

// ── Recursive workspace scan ──────────────────────────────────────────────────

export async function scanWorkspace(root: string, index: SymbolIndex): Promise<void> {
  const entries: string[] = [];

  async function walk(dir: string) {
    let children: string[];
    try { children = await fs.readdir(dir); } catch { return; }
    await Promise.all(children.map(async name => {
      if (SKIP_DIRS.has(name)) return;
      const full = path.join(dir, name);
      let stat;
      try { stat = await fs.stat(full); } catch { return; }
      if (stat.isDirectory()) {
        await walk(full);
      } else if (name.endsWith('.kt') || name.endsWith('.kts') || name.endsWith('.java')) {
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
