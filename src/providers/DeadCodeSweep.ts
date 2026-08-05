// The pure modules, never the providers: those host the VS Code layer, whose
// static initializers touch the API at module load. Importing one here would
// make this file, and every harness built on it, unloadable outside an
// extension host.
import { findUnusedImports } from './unusedImports';
import { findUnusedParameters } from './unusedParameters';
import { findUnusedDeclarations } from './unusedDeclarations';
import { findUnusedLocals } from './unusedLocals';
import { findWriteOnlyVariables } from './writeOnlyVariables';

/**
 * Aggregates every Kotlin dead-code detector into one list, and turns their
 * heterogeneous fix shapes into a single edit plan a file can apply at once.
 *
 * The detectors are disjoint by construction, each one bailing out where the
 * next one starts (a name mentioned nowhere belongs to KJ-026/027, a name
 * only ever assigned belongs to KJ-028, a parameter belongs to KJ-025). The
 * overlap check here is the belt to that suspenders: whenever two edits touch
 * the same range, only the first survives, so a sweep can never produce an
 * edit no single detector would have made.
 *
 * Cascades are NOT resolved: removing a variable can make an import dead, but
 * a second pass would be needed to see it. One sweep, one pass, and the user
 * can run it again.
 */

export type SweepDetector =
  | 'imports' | 'parameters' | 'declarations' | 'locals' | 'writeOnly';

export interface SweepEdit {
  start: number;
  end: number;
  text: string;
}

export interface SweepFinding {
  detector: SweepDetector;
  /** 0-based position used to report the finding. */
  line: number;
  character: number;
  name: string;
  message: string;
  /** Empty when the detector refuses to propose a safe edit. */
  edits: SweepEdit[];
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/**
 * Every finding of every detector for one file, in document order.
 *
 * For Java only the declarations detector runs: the other four carry Kotlin
 * grammar assumptions (import forms, scope functions, lambda parameters) and
 * running them on Java would trade correctness for coverage.
 */
export function sweepFile(text: string, lang: 'kotlin' | 'java' = 'kotlin'): SweepFinding[] {
  const starts = lineStartsOf(text);
  const lineEnd = (line: number) => (line + 1 < starts.length ? starts[line + 1] : text.length);
  const out: SweepFinding[] = [];

  if (lang === 'java') {
    for (const d of findUnusedDeclarations(text, 'java')) {
      out.push({
        detector: 'declarations',
        line: d.line,
        character: d.character,
        name: d.name,
        message: `Declaration '${d.name}' is never used`,
        edits: d.removeStart === -1 ? [] : [{ start: d.removeStart, end: d.removeEnd, text: '' }],
      });
    }
    return out.sort((a, b) => a.line - b.line || a.character - b.character);
  }

  for (const imp of findUnusedImports(text)) {
    const indent = imp.statement.length - imp.statement.trimStart().length;
    out.push({
      detector: 'imports',
      line: imp.line,
      character: indent,
      name: imp.statement.trim().replace(/^import\s+/, ''),
      message: 'Import is never used',
      edits: [{ start: starts[imp.line], end: lineEnd(imp.line), text: '' }],
    });
  }

  for (const p of findUnusedParameters(text)) {
    // Only the declaration side: call-site arguments live in other files and
    // are the code action's job, not a bulk file sweep's.
    out.push({
      detector: 'parameters',
      line: p.line,
      character: p.character,
      name: p.name,
      message: `${p.kind === 'ctorProp' ? 'Property' : 'Parameter'} '${p.name}' is never used`,
      edits: [],
    });
  }

  for (const d of findUnusedDeclarations(text)) {
    out.push({
      detector: 'declarations',
      line: d.line,
      character: d.character,
      name: d.name,
      message: `Declaration '${d.name}' is never used`,
      edits: d.removeStart === -1 ? [] : [{ start: d.removeStart, end: d.removeEnd, text: '' }],
    });
  }

  for (const l of findUnusedLocals(text)) {
    out.push({
      detector: 'locals',
      line: l.line,
      character: l.character,
      name: l.name,
      message: `${l.kind === 'catchBinding' ? 'Caught exception' : l.kind === 'lambdaParam' ? 'Lambda parameter' : 'Variable'} '${l.name}' is never used`,
      edits: l.fix === 'none' ? [] : [{ start: l.fixStart, end: l.fixEnd, text: l.fixText }],
    });
  }

  for (const w of findWriteOnlyVariables(text)) {
    out.push({
      detector: 'writeOnly',
      line: w.line,
      character: w.character,
      name: w.name,
      message: `Variable '${w.name}' is assigned but never read`,
      edits: w.edits.map(e => ({ start: e.start, end: e.end, text: e.text })),
    });
  }

  return out.sort((a, b) => a.line - b.line || a.character - b.character);
}

/**
 * Merges the findings' edits into one plan. Overlapping edits are dropped
 * rather than merged: two detectors disagreeing about the same range is a
 * situation no single one was tested for.
 *
 * Returned back to front, so a caller can apply them in order without
 * recomputing a single offset.
 */
export function planFileEdits(findings: readonly SweepFinding[]): SweepEdit[] {
  const all = findings.flatMap(f => f.edits).sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: SweepEdit[] = [];
  for (const edit of all) {
    if (edit.start < 0 || edit.end < edit.start) continue;
    const previous = kept[kept.length - 1];
    if (previous && edit.start < previous.end) continue; // overlap: keep the first
    kept.push(edit);
  }
  return kept.reverse();
}

/** Applies a plan to text. Exported so tests can prove the result compiles. */
export function applyEdits(text: string, edits: readonly SweepEdit[]): string {
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** One line per detector, for the command's summary. */
export function summarize(findings: readonly SweepFinding[]): Map<SweepDetector, number> {
  const counts = new Map<SweepDetector, number>();
  for (const f of findings) counts.set(f.detector, (counts.get(f.detector) ?? 0) + 1);
  return counts;
}
