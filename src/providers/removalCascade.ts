import { findUnusedImports } from './unusedImports';
import { fileBecomesEmpty, wholeLineExtent } from './unusedSymbols';

/**
 * KJ-048: what a removal leaves behind.
 *
 * Deleting a function takes its body with it, never the imports that body was
 * the only user of. `DeadCodeSweep` says so in as many words ("Cascades are
 * NOT resolved"), and on /workspace/exampleapp applying every
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

export interface Cut {
  start: number;
  end: number;
  /**
   * What replaces the range, when the cut is a rewrite rather than a
   * deletion. A lifted `try` body (KJ-069) keeps using the imports its
   * statements name, so simulating the cut as a deletion reported them
   * orphaned and the fix deleted an import the file still needs.
   */
  replacement?: string;
}

export interface Cascade {
  /** Whole-line extents of the imports the cuts orphaned, per file. */
  imports: Map<string, Cut[]>;
  /** Files left with nothing but package, imports, file annotations, comments. */
  emptyFiles: string[];
}

/**
 * The same answer, arranged so a caller can act on it BEFORE writing its own
 * edits.
 *
 * That order is not a style choice. VS Code rejects a WorkspaceEdit that both
 * deletes a URI and edits a range in it, and it rejects the WHOLE edit without
 * a word. Consulted afterwards, the cascade would ask to delete a file the
 * caller had already range edited, and the removal would silently do nothing.
 * Reachable on any testOnly declaration alone in its file, which the scan never
 * marks as emptying it.
 */
export interface CascadePlan {
  /** Delete these whole. The caller must add NO range edit for them. */
  deleteFiles: Set<string>;
  /** Import lines to cut, per file that survives. */
  imports: Map<string, Cut[]>;
}

export function planCascade(
  cutsByPath: ReadonlyMap<string, readonly Cut[]>,
  textByPath: ReadonlyMap<string, string>,
  /** Files the caller already decided to delete. */
  alreadyDeleted: ReadonlySet<string> = new Set(),
): CascadePlan {
  const cascade = cascadeAfterRemoval(cutsByPath, textByPath);
  const deleteFiles = new Set(cascade.emptyFiles.filter(p => !alreadyDeleted.has(p)));
  const imports = new Map<string, Cut[]>();
  for (const [path, extents] of cascade.imports) {
    if (deleteFiles.has(path) || alreadyDeleted.has(path)) continue;
    imports.set(path, extents);
  }
  return { deleteFiles, imports };
}

function applyCuts(text: string, cuts: readonly Cut[]): string {
  let out = text;
  for (const c of [...cuts].sort((a, b) => b.start - a.start)) {
    if (c.start < 0 || c.end < c.start) continue;
    // A rewrite keeps its own bounds: widening it to whole lines would swallow
    // what the replacement text is meant to put back.
    if (c.replacement !== undefined) {
      out = out.slice(0, c.start) + c.replacement + out.slice(c.end);
      continue;
    }
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

    // Emptiness is language agnostic: `package a;` reads the same either way,
    // and gating it on the extension left every emptied Java file standing as
    // a shell. The import half followed on the day the detector learned the
    // Java forms (KJ-068); `.kts` stays out, a build script imports plugins.
    if (fileBecomesEmpty(text, [...cuts])) cascade.emptyFiles.push(path);
    if (!/\.(?:kt|java)$/.test(path)) continue;

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
    if (extents.length > 0) cascade.imports.set(path, avecUneLigneVide(text, extents, cuts));
  }
  return cascade;
}

/**
 * A run of import lines framed by two blank lines takes one of them along.
 *
 * Cut line by line, a whole import block left the blank line under `package`
 * and the one under the imports side by side: `BasePostViewModel.kt` on the
 * reference project, and detekt rejected it (`NoConsecutiveBlankLines`). The
 * declaration cuts have followed this rule for a long time
 * (`sansTrouDeLignesVides`). The extent still starts on its import line; only
 * its end grows, and never over a line a declaration cut already claims.
 */
function avecUneLigneVide(text: string, extents: Cut[], cuts: readonly Cut[]): Cut[] {
  const triees = [...extents].sort((a, b) => a.start - b.start);
  const reclamees = cuts.filter(c => c.start >= 0 && c.end >= c.start).map(c => wholeLineExtent(text, c.start, c.end));
  const vide = (debut: number, fin: number) => text.slice(debut, fin).trim() === '';
  const entieres = (d: number, f: number) =>
    d < f && (d === 0 || text[d - 1] === '\n') && (f === text.length || text[f - 1] === '\n');
  // The run of removed lines, the caller's whole line cuts included: an import
  // block may go partly with the sweep and partly here.
  const retirees: Cut[] = [...triees, ...cuts.filter(c => c.replacement === undefined && entieres(c.start, c.end))];
  return triees.map(e => {
    let debut = e.start;
    for (let r = retirees.find(x => x.end === debut); r; r = retirees.find(x => x.end === debut)) debut = r.start;
    const avantVide = debut === 0 || vide(text.lastIndexOf('\n', debut - 2) + 1, debut);
    const finLigneApres = text.indexOf('\n', e.end);
    if (!avantVide || finLigneApres === -1 || !vide(e.end, finLigneApres)) return e;
    const etendue = { start: e.end, end: finLigneApres + 1 };
    return reclamees.some(r => r.start < etendue.end && r.end > etendue.start) ? e : { ...e, end: etendue.end };
  });
}
