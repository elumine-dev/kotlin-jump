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

import { CONVENTION_FUN_NAMES, sanitizeForUsageScan } from '../util/kotlinScan';

export interface UnusedImport {
  /** 0-based line of the import. */
  line: number;
  /** Full text of the import line. */
  statement: string;
}

const IMPORT_RE = /^\s*import\s+([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*(?:\/\/.*)?$/;

/**
 * Names Kotlin resolves BY CONVENTION, so the call site never spells them.
 *
 * `import androidx.compose.runtime.getValue` is required by `var x by remember
 * { … }`, and the word `getValue` appears nowhere in the file. Reported as
 * unused, removed on that advice, the module stops compiling: "Property
 * delegate must have a 'getValue(…)' method". Verified on a real app, the
 * compiler refuses the file the moment the import goes.
 *
 * The same holds for every operator convention: `component1` comes from
 * destructuring, `iterator` from a `for` loop, `get` from `x[i]`, `invoke`
 * from `x()`. None of them is ever written at the point of use.
 *
 * The cost is a genuinely unused import whose name happens to be one of these,
 * which stays silent. That is the trade the whole family makes: an occurrence
 * we cannot classify counts as a use.
 *
 * Same vocabulary as the declaration-side detectors (`unusedDeclarations.ts:163`,
 * `unusedMembers.ts:456`), which have guarded these names since the start. The
 * import side was the one place the list had never been applied.
 */
function isResolvedByConvention(effectiveName: string): boolean {
  return CONVENTION_FUN_NAMES.has(effectiveName) || /^component\d+$/.test(effectiveName);
}

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
    if (isResolvedByConvention(im.effectiveName)) continue;
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
