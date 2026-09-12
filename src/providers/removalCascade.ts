import { findUnusedImports } from './unusedImports';
import { fileBecomesEmpty, wholeLineExtent } from './unusedSymbols';

/**
 * KJ-048: what a removal leaves behind.
 *
 * Deleting a function takes its body with it, never the imports that body was
 * the only user of. `DeadCodeSweep` says so in as many words ("Cascades are
 * NOT resolved"), and on /Users/kevin/Desktop/work/lapresse applying every
 * removal the extension offers left 100 newly dead imports across 36 files,
 * plus shells holding nothing but a package line.
 *
 * This computes the second pass so a fix can carry it: the imports that became
 * unused BECAUSE of the cuts, and the files that no longer hold any code.
 *
 * Imports that were ALREADY dead before the cuts are left alone. They are
 * KJ-009's finding, they carry their own lightbulb, and folding them in here
 * would silently widen a fix the user asked for something else.
 */

export interface Cut { start: number; end: number }

export interface Cascade {
  /** Whole-line extents of the imports the cuts orphaned, per file. */
  imports: Map<string, Cut[]>;
  /** Files left with nothing but package, imports, file annotations, comments. */
  emptyFiles: string[];
}

function applyCuts(text: string, cuts: readonly Cut[]): string {
  let out = text;
  for (const c of [...cuts].sort((a, b) => b.start - a.start)) {
    if (c.start < 0 || c.end < c.start) continue;
    const w = wholeLineExtent(out, c.start, c.end);
    out = out.slice(0, w.start) + out.slice(w.end);
  }
  return out;
}

/** Offset of the start of `line`, and of the start of the line after it. */
function lineExtent(text: string, line: number): Cut | undefined {
  let at = 0;
  for (let l = 0; l < line; l++) {
    const next = text.indexOf('\n', at);
    if (next === -1) return undefined;
    at = next + 1;
  }
  const end = text.indexOf('\n', at);
  return { start: at, end: end === -1 ? text.length : end + 1 };
}

export function cascadeAfterRemoval(
  cutsByPath: ReadonlyMap<string, readonly Cut[]>,
  textByPath: ReadonlyMap<string, string>,
): Cascade {
  const cascade: Cascade = { imports: new Map(), emptyFiles: [] };

  for (const [path, cuts] of cutsByPath) {
    const text = textByPath.get(path);
    if (text === undefined || cuts.length === 0) continue;

    // Emptiness is language agnostic: `package a;` reads the same either way.
    // Only the IMPORT half carries Kotlin grammar, and gating both on the
    // extension left every emptied Java file standing as a shell.
    if (fileBecomesEmpty(text, [...cuts])) cascade.emptyFiles.push(path);
    if (!/\.kt$/.test(path)) continue;

    const before = new Set(findUnusedImports(text).map(i => i.statement.trim()));
    const after = applyCuts(text, cuts);
    const orphaned = findUnusedImports(after).filter(i => !before.has(i.statement.trim()));

    // The offsets above are measured on the CUT text; map each import back to
    // its line in the original by its statement, which is unique per file.
    const lignes = text.split('\n');
    const extents: Cut[] = [];
    // A file may import the same name twice. Mapping both orphans by the first
    // matching line produced the SAME extent twice, so the plan asked to delete
    // one range and leave the duplicate standing.
    const consommees = new Set<number>();
    for (const imp of orphaned) {
      const wanted = imp.statement.trim();
      const line = lignes.findIndex((l, i) => !consommees.has(i) && l.trim() === wanted);
      if (line === -1) continue;
      consommees.add(line);
      const e = lineExtent(text, line);
      if (e) extents.push(e);
    }
    if (extents.length > 0) cascade.imports.set(path, extents);
  }
  return cascade;
}
