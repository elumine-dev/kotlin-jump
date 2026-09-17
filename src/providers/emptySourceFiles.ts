import { sanitizeForUsageScan } from '../util/kotlinScan';
import { plural } from '../util/plural';

/**
 * KJ-060: a source file that declares nothing.
 *
 * A file left with a `package` line, a few imports and nothing else is what
 * a removal leaves behind when it took the last declaration and nothing
 * looked again. The cascade of `Remove Everything Unused` deletes a file it
 * EMPTIES in the same round, but a file that was already empty when the
 * round began is seen by no detector: every one of them looks for
 * declarations, and there are none to find.
 *
 * The test is literal, on purpose. After comments and strings are blanked,
 * every remaining line must be a `package` line, an `import` line, a
 * `@file:` annotation, a lone semicolon or blank. A `typealias`, a
 * top-level `val`, a `fun main`, anything at all keeps the file. Two files
 * that legitimately declare nothing are excluded by name: `package-info.java`
 * carries package annotations and `module-info.java` a module descriptor.
 */

export interface EmptySourceFile {
  path: string;
  /** Lines the file has, for the report. */
  lines: number;
}

export interface EmptySourceScanInput {
  sources: readonly { path: string; text: string }[];
  truncated?: boolean;
}

const SOURCE_RE = /\.(kt|kts|java)$/;
const EXEMPT_RE = /[\\/](?:package-info|module-info)\.java$/;
const NOTHING_RE = /^\s*(?:package\b[^\n]*|import\b[^\n]*|@file\s*:[^\n]*|;)?\s*$/;

/** True when `text` holds no code once comments and strings are gone. */
export function declaresNothing(text: string): boolean {
  const clean = sanitizeForUsageScan(text);
  for (const line of clean.split('\n')) {
    if (!NOTHING_RE.test(line)) return false;
  }
  return true;
}

export function findEmptySourceFiles(input: EmptySourceScanInput): EmptySourceFile[] {
  if (input.truncated) return [];
  const out: EmptySourceFile[] = [];
  for (const s of input.sources) {
    if (!SOURCE_RE.test(s.path) || EXEMPT_RE.test(s.path)) continue;
    // A `.kts` build script runs top-level statements; it is code by nature.
    if (s.path.endsWith('.kts')) continue;
    if (!declaresNothing(s.text)) continue;
    out.push({ path: s.path, lines: s.text.split('\n').length });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The one line a report ends on. Exported for the witness. */
export function emptySourceSummary(files: readonly EmptySourceFile[]): string {
  if (files.length === 0) return 'No empty source file: every file declares something.';
  return `${plural(files.length, 'source file')} declaring nothing.`;
}
