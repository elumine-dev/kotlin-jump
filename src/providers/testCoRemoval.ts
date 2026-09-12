import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { buildLineStarts, offsetToPos, sanitizeForUsageScan } from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isTestSourceSet } from '../util/testPaths';

/**
 * KJ-047: the tests that go with a declaration used only from tests.
 *
 * A `testOnly` verdict says the declaration is exercised and nothing else,
 * which is exactly the shape of code kept alive by its own test. The other
 * detectors stop there and withhold their fix, so the user is left to find the
 * tests by hand. This plans that half: which test functions exist only to
 * exercise the names, and which test FILES hold nothing else.
 *
 * THE CONTRACT, same discipline as the rest of the family:
 *
 *  1. A mention we cannot place inside a test function is `unresolved`, and
 *     one unresolved mention withholds the whole plan. Guessing here deletes
 *     a test that also covers something else.
 *  2. Offsets are recomputed on the text as it is now, never carried from a
 *     scan.
 *  3. A file goes whole only when every one of its test functions is in the
 *     plan. Cutting all the tests out and leaving the shell behind is worse
 *     than leaving the file alone.
 */

export interface TestCut {
  path: string;
  start: number;
  end: number;
  /** Test function removed, or the imported name for an import line. */
  name: string;
  kind: 'function' | 'import';
}

export interface TestCoRemovalPlan {
  /** Test files whose every test function is in the plan. */
  files: string[];
  /** Ranges to cut in the test files that survive. */
  cuts: TestCut[];
  /** Mentions that could not be placed. Non empty means: offer nothing. */
  unresolved: { path: string; line: number; reason: string }[];
  /** Test functions the plan removes, files included. */
  functions: number;
}

const IMPORT_RE = /^\s*import\s+/;

/** Whole-line extent around `[start, end)`, so no orphan blank line is left. */
function wholeLines(text: string, start: number, end: number): { start: number; end: number } {
  let from = text.lastIndexOf('\n', Math.max(start - 1, 0));
  from = from === -1 ? 0 : from + 1;
  let to = text.indexOf('\n', Math.max(end - 1, 0));
  to = to === -1 ? text.length : to + 1;
  return { start: from, end: to };
}

/** Annotations and KDoc directly above a test function belong to it. */
function withHeader(lines: readonly string[], lineStarts: readonly number[], firstLine: number): number {
  let l = firstLine;
  for (let k = firstLine - 1; k >= 0; k--) {
    const trimmed = (lines[k] ?? '').trim();
    if (trimmed.startsWith('@')) { l = k; continue; }
    if (trimmed.startsWith('//')) { l = k; continue; }
    if (trimmed.endsWith('*/') && (trimmed.startsWith('/*') || trimmed.startsWith('*'))) {
      let j = k;
      while (j >= 0) {
        const t = (lines[j] ?? '').trim();
        if (t.startsWith('/*')) break;
        if (!t.startsWith('*')) { j = -1; break; }
        j--;
      }
      if (j >= 0) { l = j; k = j; continue; }
    }
    break;
  }
  return lineStarts[l];
}

interface TestFunction { name: string; start: number; end: number }

/** Every `@Test` function of a file, with the extent a removal would cut. */
export function testFunctionsOf(path: string, text: string): TestFunction[] {
  const parsed = path.endsWith('.java') ? parseJava(path, text) : parse(path, text);
  const clean = sanitizeForUsageScan(text);
  const lineStarts = buildLineStarts(clean);
  const lastLine = lineStarts.length - 1;
  const lines = text.split('\n');
  const out: TestFunction[] = [];
  for (const sym of parsed.symbols) {
    if (!sym.isTest) continue;
    if (sym.kind !== 'fun' && sym.kind !== 'composable') continue;
    const span = declarationSpan(clean, lineStarts, {
      kind: 'fun',
      name: sym.name,
      line: sym.line,
      nameOffset: lineStarts[sym.line] + sym.character,
      lastLine,
    });
    if (!span) continue;
    const endLine = offsetToPos(lineStarts as number[], Math.max(span.scanEnd - 1, 0)).line;
    out.push({
      name: sym.name,
      start: withHeader(lines, lineStarts, sym.line),
      end: endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The tests that exist only to exercise `names`.
 *
 * `names` is the set a single finding covers: one symbol, one member, or every
 * declaration of a dead island. Passing them together matters, because a test
 * that names two members of the same island is one test, not two.
 */
export function planTestCoRemoval(
  names: readonly string[],
  sources: readonly { path: string; text: string }[],
  testSourceSets: readonly string[],
  /**
   * Production declarations that SURVIVE this removal. A test function that
   * also exercises one of them is not ours to delete.
   *
   * Found on /Users/kevin/Desktop/work/lapresse: `ReplicaConstTest.testConsts`
   * is one test function asserting twenty dead `AnimConst` values AND four
   * live `ReplicaConst` ones. Without this set the file went whole, and live
   * code silently lost its only test.
   */
  liveNames?: ReadonlySet<string>,
  /**
   * Names allowed to appear without disqualifying the test: the declaration's
   * own container above all. A test for `EditionModel.hasBrandIcon` names
   * `EditionModel` by construction, and treating that as "covers something
   * else" withheld every member of the family.
   */
  allowed: readonly string[] = [],
): TestCoRemovalPlan {
  const wanted = names.filter(n => n.length > 0);
  const plan: TestCoRemovalPlan = { files: [], cuts: [], unresolved: [], functions: 0 };
  if (wanted.length === 0) return plan;
  const mention = new RegExp(`\\b(?:${wanted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

  for (const src of sources) {
    if (!isTestSourceSet(src.path, testSourceSets)) continue;
    if (!/\.(kt|java)$/.test(src.path)) continue;
    mention.lastIndex = 0;
    if (!mention.test(src.text)) continue;

    // Comments and string bodies are not references, here as everywhere else.
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const lines = src.text.split('\n');
    const funs = testFunctionsOf(src.path, src.text);
    const hit = new Set<TestFunction>();
    const imports: TestCut[] = [];
    let unresolved = false;

    mention.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = mention.exec(clean)) !== null) {
      const at = m.index;
      const line = offsetToPos(lineStarts as number[], at).line;
      if (IMPORT_RE.test(lines[line] ?? '')) {
        const w = wholeLines(src.text, lineStarts[line], lineStarts[line] + (lines[line] ?? '').length + 1);
        imports.push({ path: src.path, start: w.start, end: w.end, name: m[0], kind: 'import' });
        continue;
      }
      const owner = funs.find(f => at >= f.start && at < f.end);
      if (owner) { hit.add(owner); continue; }
      plan.unresolved.push({ path: src.path, line, reason: 'mention outside any test function' });
      unresolved = true;
    }

    if (unresolved) continue;
    if (hit.size === 0 && imports.length === 0) continue;

    if (liveNames !== undefined) {
      const wantedSet = new Set([...wanted, ...allowed]);
      let coversSomethingElse = false;
      for (const f of hit) {
        const corps = clean.slice(f.start, f.end);
        for (const jeton of corps.match(/\b[A-Za-z_]\w*\b/g) ?? []) {
          if (wantedSet.has(jeton) || !liveNames.has(jeton)) continue;
          plan.unresolved.push({
            path: src.path,
            line: offsetToPos(lineStarts as number[], f.start).line,
            reason: `test also exercises ${jeton}`,
          });
          coversSomethingElse = true;
          break;
        }
        if (coversSomethingElse) break;
      }
      if (coversSomethingElse) continue;
    }

    if (funs.length > 0 && hit.size === funs.length) {
      plan.files.push(src.path);
      plan.functions += funs.length;
      continue;
    }
    // An import with no test function of its own to carry it means the name is
    // reached from somewhere this plan did not see.
    if (hit.size === 0) {
      plan.unresolved.push({ path: src.path, line: 0, reason: 'imported but never used inside a test function' });
      continue;
    }
    for (const f of hit) plan.cuts.push({ path: src.path, start: f.start, end: f.end, name: f.name, kind: 'function' });
    plan.cuts.push(...imports);
    plan.functions += hit.size;
  }

  plan.cuts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start));
  return plan;
}

/** True when the plan is safe to offer: something to do, nothing unexplained. */
export function isOfferable(plan: TestCoRemovalPlan): boolean {
  return plan.unresolved.length === 0 && (plan.files.length > 0 || plan.cuts.length > 0);
}
