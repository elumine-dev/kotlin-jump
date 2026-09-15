import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { buildLineStarts, offsetToPos, sanitizeForUsageScan } from '../util/kotlinScan';
import { isTestSourceSet } from '../util/testPaths';
import { declarationSpan, SpanKind } from '../util/declarationSpan';
import { TestCoRemovalPlan, TestCut, testFunctionsOf } from './testCoRemoval';

/**
 * KJ-053: the CLOSURE planner behind `Remove Code Used Only by Tests: Unproven
 * Groups, Review Each`.
 *
 * `planTestCoRemoval` (KJ-047) answers "can this be offered on its own?", and
 * says no the moment a mention cannot be placed inside a test function or a
 * test function also names something live. That is the right answer for a
 * command that applies silently.
 *
 * This planner answers a different question: "if the reader accepts this
 * group in the Refactor Preview, does the workspace still compile?" It does
 * not trust its own placement of mentions. It builds the edit, applies it IN
 * MEMORY, and scans every surviving source for every name the edit removes.
 * One surviving mention withholds the group with the file that holds it.
 *
 * What the closure guarantees: no source names a removed declaration once the
 * edit is applied. What it does not: that the tests it cuts covered nothing
 * else. That second point is coverage, not compilation, and it is what the
 * reader judges box by box.
 *
 * Three shapes measured on the reference project drove the rules below. All
 * three compiled once the closure was enforced, and all three broke the build
 * under the placement-only planner:
 *   `ResizePhotoUseCaseTest`   the type lives in a field and a @Before; no
 *                              @Test function names it; the file goes whole.
 *   `AssemblerBaseTest`        the type lives in a field of a base class other
 *                              tests extend; taking the file whole would orphan
 *                              them, so the group is withheld.
 *   `PageSchemaBuilderTest`    the mention sits in a test function of a source
 *                              set the placement planner never reached.
 */

export interface ClosurePlan extends TestCoRemovalPlan {
  /** The test types deleted with their files: other files lose their imports of them. */
  removedTestTypes: string[];
  /** Non empty when the closure could not be reached; the plan must not be offered. */
  withheld?: string;
  /** How many test functions the plan cuts, for the label. */
  cutFunctions: number;
}

interface Src { path: string; text: string }

const IMPORT_RE = /^\s*import\s+/;
const CLASS_LIKE = new Set(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum', 'annotation']);
/** Cascading whole-file deletions is where over-deletion hides; this stops at one. */
const MAX_ROUNDS = 8;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeLines(text: string, start: number, end: number): { start: number; end: number } {
  let from = text.lastIndexOf('\n', Math.max(start - 1, 0));
  from = from === -1 ? 0 : from + 1;
  let to = text.indexOf('\n', Math.max(end - 1, 0));
  to = to === -1 ? text.length : to + 1;
  return { start: from, end: to };
}

/** Offsets of every whole-word mention of `name` in `clean`. */
function mentionOffsets(name: string, clean: string): number[] {
  const re = new RegExp(`\\b${escape(name)}\\b`, 'g');
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) out.push(m.index);
  return out;
}

/** The type names a file declares. */
function declaredTypes(path: string, text: string): string[] {
  const parsed = path.endsWith('.java') ? parseJava(path, text) : parse(path, text);
  const names = new Set<string>();
  for (const sym of parsed.symbols) {
    if (!CLASS_LIKE.has(sym.kind) || sym.name.length === 0) continue;
    // Every Kotlin class may declare one; the name identifies nothing across
    // files and withheld `DeepLinkCoordinatorTest` for naming it.
    if (sym.name === 'Companion') continue;
    names.add(sym.name);
  }
  return [...names];
}

interface Decl {
  name: string; kind: SpanKind; start: number; end: number; depth: number;
  /** Carries @Before, @After, @Rule or kin: run by the framework, called by nobody. */
  lifecycle: boolean;
}

/**
 * Annotations that make a declaration run without a caller. Cutting one on its
 * own leaves the tests it served to fail at runtime, which no compilation
 * catches: on the reference project, `ServerModelDOTest` lost its `@Before
 * setUp()` and its surviving tests threw NullPointerException at line 43.
 */
const LIFECYCLE_RE = /^\s*@(?:get:|set:)?(?:Before|BeforeEach|BeforeTest|BeforeClass|BeforeAll|After|AfterEach|AfterTest|AfterClass|AfterAll|Rule|ClassRule)\b/;

/** Annotations and comments directly above a declaration belong to it. */
function withHeader(lines: readonly string[], lineStarts: readonly number[], firstLine: number): { start: number; lifecycle: boolean } {
  let l = firstLine;
  let lifecycle = LIFECYCLE_RE.test(lines[firstLine] ?? '');
  for (let k = firstLine - 1; k >= 0; k--) {
    const t = (lines[k] ?? '').trim();
    if (t.startsWith('@') || t.startsWith('//')) {
      if (LIFECYCLE_RE.test(t)) lifecycle = true;
      l = k;
      continue;
    }
    break;
  }
  return { start: lineStarts[l], lifecycle };
}

/**
 * Every declaration of a file with its extent: functions, properties and
 * class-like types, test or not. `testFunctionsOf` keeps only the @Test
 * ones; the closure needs the helpers too, because a helper that names a
 * removed member goes, and the tests that call the helper go with it.
 */
function declarationsOf(path: string, text: string): Decl[] {
  const parsed = path.endsWith('.java') ? parseJava(path, text) : parse(path, text);
  const clean = sanitizeForUsageScan(text);
  const lineStarts = buildLineStarts(clean);
  const lastLine = lineStarts.length - 1;
  const lines = text.split('\n');
  const out: Decl[] = [];
  for (const sym of parsed.symbols) {
    let kind: SpanKind;
    if (sym.kind === 'fun' || sym.kind === 'composable') kind = 'fun';
    else if (sym.kind === 'val' || sym.kind === 'var') kind = 'prop';
    else if (CLASS_LIKE.has(sym.kind)) kind = 'classLike';
    else continue;
    const span = declarationSpan(clean, lineStarts, {
      kind, name: sym.name, line: sym.line, nameOffset: lineStarts[sym.line] + sym.character, lastLine,
    });
    if (!span) continue;
    const endLine = offsetToPos(lineStarts as number[], Math.max(span.scanEnd - 1, 0)).line;
    const header = withHeader(lines, lineStarts, sym.line);
    out.push({
      name: sym.name, kind,
      start: header.start,
      end: endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length,
      depth: (sym as any).depth ?? 0,
      lifecycle: header.lifecycle,
    });
  }
  return out;
}

/** The innermost declaration holding `offset`, or undefined at file level. */
function innermostAt(decls: readonly Decl[], offset: number): Decl | undefined {
  let best: Decl | undefined;
  for (const d of decls) {
    if (offset < d.start || offset >= d.end) continue;
    if (!best || (d.end - d.start) < (best.end - best.start)) best = d;
  }
  return best;
}

/** `text` with the extents removed, whole lines, later ones first. */
function applyInMemory(text: string, extents: readonly { start: number; end: number }[]): string {
  const sorted = [...extents]
    .filter(e => e.start >= 0 && e.end > e.start)
    .sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of sorted) {
    if (e.end > lastStart) continue;          // overlap with a later cut already applied
    const w = wholeLines(out, e.start, e.end);
    out = out.slice(0, w.start) + out.slice(w.end);
    lastStart = w.start;
  }
  return out;
}

/**
 * Plan the removal of `names` and of everything in test sources that names
 * them, then prove the plan closes.
 *
 * `productionExtents` are the cuts the caller makes in main sources (the
 * declarations themselves). They take part in the simulation so a mention
 * inside a removed declaration does not count as surviving.
 */
export function planClosure(
  names: readonly string[],
  sources: readonly Src[],
  testSourceSets: readonly string[],
  productionExtents: readonly { path: string; start: number; end: number }[],
): ClosurePlan {
  const plan: ClosurePlan = { files: [], cuts: [], unresolved: [], functions: 0, removedTestTypes: [], cutFunctions: 0 };
  const wanted = names.filter(n => n.length > 0);
  if (wanted.length === 0) { plan.withheld = 'nothing to remove'; return plan; }

  const byPath = new Map(sources.map(s => [s.path, s]));
  const productionByPath = new Map<string, { start: number; end: number }[]>();
  for (const e of productionExtents) (productionByPath.get(e.path) ?? productionByPath.set(e.path, []).get(e.path)!).push(e);

  const deleted = new Set<string>();
  const cutsByPath = new Map<string, TestCut[]>();
  const cutKeys = new Set<string>();
  const removedTypes = new Set<string>();
  const cleanCache = new Map<string, string>();
  const clean = (s: Src) => cleanCache.get(s.path) ?? cleanCache.set(s.path, sanitizeForUsageScan(s.text)).get(s.path)!;

  const addCut = (path: string, start: number, end: number, name: string, kind: TestCut['kind']) => {
    const key = `${path}:${start}:${end}`;
    if (cutKeys.has(key)) return;
    cutKeys.add(key);
    (cutsByPath.get(path) ?? cutsByPath.set(path, []).get(path)!).push({ path, start, end, name, kind });
    if (kind === 'function') plan.cutFunctions++;
  };

  const withhold = (why: string): ClosurePlan => { plan.withheld = why; plan.unresolved.push({ path: '', line: 0, reason: why }); return plan; };

  /** True when `offset` in `src` falls inside one of the caller's production cuts. */
  const insideProductionCut = (src: Src, offset: number) =>
    (productionByPath.get(src.path) ?? []).some(e => offset >= e.start && offset < e.end);

  const queue = [...wanted];
  const seen = new Set<string>();
  const declsCache = new Map<string, Decl[]>();
  /** The path of a file that names a type this one declares, outside an import; undefined when none. */
  const usedByOtherFiles = (src: Src): string | undefined => {
    for (const t of declaredTypes(src.path, src.text)) {
      for (const other of sources) {
        if (other.path === src.path || deleted.has(other.path)) continue;
        if (!/\.(kt|kts|java)$/.test(other.path)) continue;
        const oc = clean(other);
        const hits = mentionOffsets(t, oc);
        if (hits.length === 0) continue;
        const os = buildLineStarts(oc);
        const ol = other.text.split('\n');
        if (hits.some(h => !IMPORT_RE.test(ol[offsetToPos(os as number[], h).line] ?? ''))) return other.path;
      }
    }
    return undefined;
  };
  /** Names cut inside a test file, chased only within that file. */
  const localNames = new Map<string, Set<string>>();
  const localQueue: { path: string; name: string }[] = [];
  let rounds = 0;
  while (queue.length > 0) {
    if (++rounds > MAX_ROUNDS * 50) return withhold('closure did not settle');
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const isProductionName = wanted.includes(name);

    for (const src of sources) {
      if (deleted.has(src.path)) continue;
      if (!/\.(kt|kts|java)$/.test(src.path)) continue;
      const text = clean(src);
      const offsets = mentionOffsets(name, text).filter(o => !insideProductionCut(src, o));
      if (offsets.length === 0) continue;

      const lineStarts = buildLineStarts(text);
      const lines = src.text.split('\n');
      const isTest = isTestSourceSet(src.path, testSourceSets);

      if (!isTest) {
        // A main source still names it. For a production name the verdict was
        // wrong or the extents incomplete; for a removed test type, main code
        // depends on a test. Either way the edit would not compile.
        const line = offsetToPos(lineStarts as number[], offsets[0]).line;
        if (IMPORT_RE.test(lines[line] ?? '') && offsets.every(o => IMPORT_RE.test(lines[offsetToPos(lineStarts as number[], o).line] ?? ''))) {
          // Only imports: those go, as the safe planner does since 1.42.336.
          for (const o of offsets) {
            const l = offsetToPos(lineStarts as number[], o).line;
            const w = wholeLines(src.text, lineStarts[l], lineStarts[l] + (lines[l] ?? '').length + 1);
            addCut(src.path, w.start, w.end, name, 'import');
          }
          continue;
        }
        return withhold(`${name} is still used by ${isProductionName ? 'main source' : 'main code'} ${src.path}`);
      }

      const funs = testFunctionsOf(src.path, src.text);
      const decls = declsCache.get(src.path) ?? declsCache.set(src.path, declarationsOf(src.path, src.text)).get(src.path)!;
      let whole = false;
      for (const o of offsets) {
        const line = offsetToPos(lineStarts as number[], o).line;
        if (IMPORT_RE.test(lines[line] ?? '')) {
          const w = wholeLines(src.text, lineStarts[line], lineStarts[line] + (lines[line] ?? '').length + 1);
          addCut(src.path, w.start, w.end, name, 'import');
          continue;
        }
        const owner = funs.find(f => o >= f.start && o < f.end);
        if (owner) { addCut(src.path, owner.start, owner.end, owner.name, 'function'); continue; }
        // Outside every @Test function. The first draft took the file whole
        // here, and deleted `BaseLoginViewModelPopupModelTest` (7 tests) where
        // the hand written branch removed one: the mention sat in a helper of
        // a nested test double. The helper goes, its name joins the queue, and
        // the one test that calls it goes on the next round. Only a mention
        // the top level class itself holds (its header, a constructor
        // parameter) takes the file whole.
        const inner = innermostAt(decls, o);
        if (inner === undefined || (inner.kind === 'classLike' && inner.depth === 0)) { whole = true; continue; }
        // A lifecycle method has no caller to cut with it; the file is the unit.
        if (inner.lifecycle) { whole = true; continue; }
        // A class-level declaration is about to go. If OTHER files use what
        // this file declares, this file is shared infrastructure, and a cut
        // inside it reaches code the closure cannot see: the first draft cut
        // `ready()` out of a base class and left the subclass calling it. The
        // whole-file path runs the same check; a member cut needs it too.
        const user = usedByOtherFiles(src);
        if (user !== undefined) return withhold(`test file ${src.path} declaring ${declaredTypes(src.path, src.text).join(', ')} is used by ${user}`);
        addCut(src.path, inner.start, inner.end, inner.name, inner.kind === 'fun' ? 'function' : 'import');
        if (inner.kind === 'fun' && funs.some(f => f.start === inner.start)) { /* already a test function */ }
        // A helper is file-local in practice; scanning every file for a name
        // like `setup` would cut the world. The final closure check covers it.
        localNames.get(src.path)?.add(inner.name) ?? localNames.set(src.path, new Set([inner.name]));
        localQueue.push({ path: src.path, name: inner.name });
      }
      // Every test function cut leaves a shell; the shell goes too.
      const cutFunctionStarts = new Set((cutsByPath.get(src.path) ?? []).filter(c => c.kind === 'function').map(c => c.start));
      if (!whole && funs.length > 0 && funs.every(f => cutFunctionStarts.has(f.start))) whole = true;

      if (!whole) continue;

      // A test file used by OTHER files is infrastructure, not a dedicated
      // test. Deleting it would cascade; stopping here keeps the edit bounded
      // and is what withholds `AssemblerBaseTest`.
      const types = declaredTypes(src.path, src.text);
      const user = usedByOtherFiles(src);
      if (user !== undefined) return withhold(`test file ${src.path} declaring ${types.join(', ')} is used by ${user}`);
      deleted.add(src.path);
      cutsByPath.delete(src.path);
      for (const t of types) { removedTypes.add(t); queue.push(t); }
    }
  }

  // ── Names cut inside a test file: chase their callers in that file only ──
  const localSeen = new Set<string>();
  while (localQueue.length > 0) {
    if (++rounds > MAX_ROUNDS * 50) return withhold('closure did not settle');
    const { path: p, name } = localQueue.shift()!;
    const key = `${p}\0${name}`;
    if (localSeen.has(key) || deleted.has(p)) continue;
    localSeen.add(key);
    const src = byPath.get(p)!;
    const text = clean(src);
    const decls = declsCache.get(p) ?? declsCache.set(p, declarationsOf(p, src.text)).get(p)!;
    const own = decls.find(d => d.name === name);
    for (const o of mentionOffsets(name, text)) {
      if (own && o >= own.start && o < own.end) continue;          // its own declaration
      const inner = innermostAt(decls, o);
      if (inner === undefined || (inner.kind === 'classLike' && inner.depth === 0)) continue;
      if (inner.name === name) continue;
      // A lifecycle method that used a cut helper: the file is the unit, or
      // nothing. `usedByOtherFiles` decides below, as for a direct mention.
      if (inner.lifecycle) {
        const user = usedByOtherFiles(src);
        if (user !== undefined) return withhold(`test file ${p} is shared with ${user} and its lifecycle method names ${name}`);
        deleted.add(p); cutsByPath.delete(p);
        for (const t of declaredTypes(p, src.text)) { removedTypes.add(t); queue.push(t); }
        break;
      }
      addCut(p, inner.start, inner.end, inner.name, inner.kind === 'fun' ? 'function' : 'import');
      localNames.get(p)!.add(inner.name);
      localQueue.push({ path: p, name: inner.name });
    }
    // Every @Test function cut leaves a shell; the shell goes too, after the
    // same orphan check as a direct whole-file mention.
    const funs = testFunctionsOf(p, src.text);
    const cutStarts = new Set((cutsByPath.get(p) ?? []).filter(c => c.kind === 'function').map(c => c.start));
    if (funs.length > 0 && funs.every(f => cutStarts.has(f.start)) && usedByOtherFiles(src) === undefined) {
      deleted.add(p); cutsByPath.delete(p);
      for (const t of declaredTypes(p, src.text)) { removedTypes.add(t); queue.push(t); }
    }
  }
  // A whole-file deletion queued from the local pass may have added types
  // whose imports elsewhere still need cutting.
  while (queue.length > 0) {
    const t = queue.shift()!;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const src of sources) {
      if (deleted.has(src.path) || !/\.(kt|kts|java)$/.test(src.path)) continue;
      const text = clean(src);
      const ls = buildLineStarts(text); const ln = src.text.split('\n');
      for (const o of mentionOffsets(t, text)) {
        const l = offsetToPos(ls as number[], o).line;
        if (!IMPORT_RE.test(ln[l] ?? '')) return withhold(`${t} still used by ${src.path}`);
        const w = wholeLines(src.text, ls[l], ls[l] + (ln[l] ?? '').length + 1);
        addCut(src.path, w.start, w.end, t, 'import');
      }
    }
  }

  // ── Simulation, then the closure check that gives this planner its name ──
  const closureNames = [...wanted, ...removedTypes];
  for (const src of sources) {
    if (deleted.has(src.path)) continue;
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    const extents = [...(productionByPath.get(src.path) ?? []), ...(cutsByPath.get(src.path) ?? [])];
    const after = extents.length > 0 ? applyInMemory(src.text, extents) : src.text;
    const afterClean = sanitizeForUsageScan(after);
    for (const n of [...closureNames, ...(localNames.get(src.path) ?? [])]) {
      const hits = mentionOffsets(n, afterClean);
      if (hits.length === 0) continue;
      const line = offsetToPos(buildLineStarts(afterClean) as number[], hits[0]).line + 1;
      return withhold(`${n} still mentioned in ${src.path}:${line} after the edit`);
    }
  }

  plan.files = [...deleted].sort();
  for (const p of plan.files) plan.functions += testFunctionsOf(p, byPath.get(p)!.text).length;
  plan.cuts = [...cutsByPath.values()].flat().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start));
  plan.functions += plan.cutFunctions;
  plan.removedTestTypes = [...removedTypes].sort();
  return plan;
}

/** True when the closure was reached and there is something to do. */
export function isClosed(plan: ClosurePlan): boolean {
  return plan.withheld === undefined && (plan.files.length > 0 || plan.cuts.length > 0);
}
