/**
 * KJ-009: unused import graying, grays out imports whose effective name
 * (alias included) never appears in the code. Mentions inside a comment or a
 * string do not count; `${…}` and `$name` templates do count (they are code).
 * Wildcard imports are NEVER flagged (conservative: the package contents are
 * unknown).
 *
 * The detector lives here rather than in `UnusedImportProvider` so a plain Node
 * script can run it. That file hosts the VS Code layer, whose static
 * initializers touch `vscode.CodeActionKind` at module load, which is enough to
 * make the whole module unloadable outside an extension host.
 */

import { sanitizeForUsageScan } from '../util/kotlinScan';

export interface UnusedImport {
  /** 0-based line of the import. */
  line: number;
  /** Full text of the import line. */
  statement: string;
}

const IMPORT_RE = /^\s*import\s+([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*(?:\/\/.*)?$/;

export function findUnusedImports(text: string): UnusedImport[] {
  const lines = text.split('\n');
  const imports: { line: number; statement: string; effectiveName: string; wildcard: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = IMPORT_RE.exec(lines[i]);
    if (!m) continue;
    const path = m[1];
    const wildcard = Boolean(m[2]);
    const alias = m[3];
    const lastSegment = path.split('.').pop() ?? path;
    imports.push({
      line: i,
      statement: lines[i],
      effectiveName: alias ?? lastSegment,
      wildcard,
    });
  }
  if (imports.length === 0) return [];

  // Body = sanitized text WITHOUT the import lines themselves.
  const importLines = new Set(imports.map(im => im.line));
  const body = sanitizeForUsageScan(text)
    .split('\n')
    .map((l, idx) => (importLines.has(idx) ? '' : l))
    .join('\n');

  const unused: UnusedImport[] = [];
  for (const im of imports) {
    if (im.wildcard) continue; // conservative
    const usageRe = new RegExp(`\\b${escapeRegExp(im.effectiveName)}\\b`);
    if (!usageRe.test(body)) {
      unused.push({ line: im.line, statement: im.statement });
    }
  }
  return unused;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
