import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { RawSymbol } from '../indexer/KotlinParser';
import { buildLineStarts, sanitizeForUsageScan, findMatchingParen } from '../util/kotlinScan';
import { declarationSpan, SpanKind } from '../util/declarationSpan';
import { stripKotlinComments, stripXmlComments } from '../util/xmlRefs';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { isTestSourceSet } from '../util/testPaths';
import {
  BENIGN_TOPLEVEL_ANNOTATIONS,
  explainSymbols,
  matchesGlob,
  removalExtent,
  SymbolSource,
} from './unusedSymbols';
import { explainMembers } from './unusedMembers';

/**
 * KJ-046: dead islands — groups of declarations that reference only each
 * other and are referenced by nothing else.
 *
 * The per-symbol detectors prove death by absence of mention, so a symbol
 * referenced only by dead code reads as alive, and two symbols in mutual
 * recursion protect each other forever. This detector closes that gap with
 * attributed mentions: every whole-word token is either INSIDE the extent of
 * an eligible declaration, or it is a ROOT. Liveness is the least fixpoint
 * seeded by root mentions; an island is a weakly connected component of the
 * mention relation restricted to the dead complement.
 *
 * ## The invariant everything defends
 *
 * An island is dead only if EVERY mention of EVERY island name in the whole
 * corpus lies inside the island's own extents. A mention we cannot place is a
 * root, and a root means life. Every approximation error injects aliveness,
 * never deadness: extents are under-approximated (declarationSpan only, a
 * refused span removes the node and root-anchors its contents), homonyms
 * silence their whole component (all bearers of a name live or die together),
 * and files without extents (XML, proguard, gradle, strings, tests) produce
 * only roots. A guard that saves a node removes its extent from the pool,
 * which root-anchors everything its body mentions: the guard that saves a
 * node saves its island.
 *
 * ## Two structural limits, stated up front
 *
 * Generated callers under build/ are invisible; the annotation guards (I2)
 * and the generated-name convention (Dagger<N>, <N>_Factory... rooting <N>)
 * carry that safety, exactly as M4/M6 carry it for KJ-042. And a name built
 * by string concatenation for reflection is undetectable; whole-name literals
 * DO count as roots, and `maxIslandSize` bounds the damage of the rest.
 *
 * Eligibility reuses explainSymbols/explainMembers verbatim, so this detector
 * can never disagree with KJ-032/042 about a guard. Measured before building
 * (6410-file corpus): 22 islands, each hand-verified, oracle-checked (R8,
 * SDC), and — for every fixable unreferenced one — deleted on a branch with a
 * green build matrix. Two real false positives were caught by the audits and
 * each became a guard plus a named regression test: a duplicated @Component
 * interface (F3 shadowing F5 → I2's positional annotation pass, I7's
 * generated-name roots) and an ALL_CAPS companion property reached through
 * its verbatim Java accessor (→ the identity mapping in accessorProperties).
 */

export interface DeadIslandScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** `Name` or `Container.Name` globs never reported; one hit silences its island. */
  ignoreNames?: readonly string[];
  includeTestOnly?: boolean;
  /** A component larger than this is more likely an attribution bug than a
   *  forty-symbol corpse; it is withheld, never partially reported. */
  maxIslandSize?: number;
}

export type DeadIslandVerdict = 'unreferenced' | 'testOnly';

export interface IslandMember {
  name: string;
  kind: string;
  /** Enclosing chain for member declarations, null for top-level ones. */
  container: string | null;
  path: string;
  line: number;
  character: number;
  /** Whole-line removal extent, or -1: the island then loses its fix (I5). */
  removeStart: number;
  removeEnd: number;
  /** Already reported by KJ-032/042: the island groups it, does not re-claim it. */
  individuallyDead: boolean;
  /** Island names whose extents hold this member's only mentions. */
  keptAliveBy: string[];
}

export interface DeadIsland {
  members: IslandMember[];
  /** Distinct dead names of the island. */
  names: string[];
  verdict: DeadIslandVerdict;
  testMentions: number;
  /** Every member has a removal extent: the fix is island-atomic or absent. */
  fixable: boolean;
  /** Import lines that would dangle after deletion. Imports never keep a
   *  symbol alive (family rule), so they must fall with the island. */
  staleImports: { path: string; line: number; name: string }[];
}

/** One row per raw candidate of the underlying detectors, for `--why`. */
export interface IslandExplanation {
  name: string;
  container: string | null;
  path: string;
  line: number;
  /** An F-family or M-family guard, an I2/I3 pool rejection, an `alive:...`
   *  reason, `I6:subsumed`, `I8:max-size`, or `island#k` when it ships. */
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore dead-island';
const DEFAULT_MAX_ISLAND_SIZE = 8;
const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * I7: a mention of generated code names its source. `DaggerApplicationComponent`
 * in a sample app is the only caller of `ApplicationComponent` the corpus will
 * ever show — the generated class lives under build/. A token matching one of
 * these shapes, with no declaration of its own anywhere, roots its base name.
 * Found the hard way: the single false positive of the Phase-0 audit.
 */
const GENERATED_NAME_RES: readonly RegExp[] = [
  /^Dagger([A-Z]\w+)$/,
  /^Hilt_([A-Z]\w+)$/,
  /^([A-Z]\w+?)_(?:Factory|MembersInjector|Impl)$/,
  /^([A-Z]\w+?)(?:Directions|Args)$/,
];

/** Same stance as M6: these do not change reachability. Everything else does. */
const BENIGN_ANNOTATIONS = new Set([
  ...BENIGN_TOPLEVEL_ANNOTATIONS,
  'JvmStatic', 'JvmField', 'Override', 'Singleton', 'Reusable',
]);

/** Kotlin use-site targets: `@field:SerializedName` names SerializedName. */
const USE_SITE_TARGETS = new Set([
  'field', 'get', 'set', 'param', 'property', 'receiver', 'delegate', 'setparam', 'file',
]);

const SPAN_KIND: Record<string, SpanKind | undefined> = {
  fun: 'fun', composable: 'fun',
  val: 'prop', var: 'prop',
  class: 'classLike', interface: 'classLike', object: 'classLike', enum: 'classLike',
  dataClass: 'classLike', sealedClass: 'classLike', annotation: 'classLike',
};

interface PoolNode {
  name: string;
  kind: string;
  container: string | null;
  path: string;
  line: number;
  character: number;
  scanStart: number;
  scanEnd: number;
  removeStart: number;
  removeEnd: number;
  /** Explain outcome of the underlying detector: `alive:*` or a verdict. */
  outcome: string;
}

interface Analysis {
  islands: DeadIsland[];
  explanations: IslandExplanation[];
}

export function findDeadIslands(input: DeadIslandScanInput): DeadIsland[] {
  return analyze(input).islands;
}

export function explainIslands(input: DeadIslandScanInput): IslandExplanation[] {
  return analyze(input).explanations;
}

function analyze(input: DeadIslandScanInput): Analysis {
  if (input.truncated) return { islands: [], explanations: [] };     // I1

  const maxIslandSize = input.maxIslandSize ?? DEFAULT_MAX_ISLAND_SIZE;

  // ── Eligibility: the underlying detectors' own explain surfaces, so this
  // detector can never disagree with them about a guard.
  const base = { sources: input.sources, testSourceSets: input.testSourceSets };
  const rows = [
    ...explainSymbols(base).map(r => ({ ...r, container: null as string | null })),
    ...explainMembers(base).map(r => ({ ...r, container: r.container as string | null })),
  ];
  const rowKey = (p: string, line: number, name: string) => `${p} ${line} ${name}`;
  const rowByKey = new Map<string, { outcome: string; container: string | null }>();
  for (const r of rows) rowByKey.set(rowKey(r.path, r.line, r.name), r);

  // A guard outcome keeps a declaration OUT of the extent pool; its contents
  // then root-anchor whatever they mention (I2). F3 stays in: the positional
  // model locates instead of subtracting, so the census F3 defends is free.
  const isGuarded = (outcome: string): boolean =>
    /^[A-Z]+\d/.test(outcome) && !/^F3:/.test(outcome) && !/^H10:/.test(outcome);

  // ── Extent pool + the set of every declared name in the corpus.
  const declaredNames = new Set<string>();
  const poolByFile = new Map<string, PoolNode[]>();
  const nodes: PoolNode[] = [];
  const poolRejections: IslandExplanation[] = [];

  for (const src of input.sources) {
    if (!/\.(kt|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const parsed = src.path.endsWith('.java') ? parseJava(src.path, src.text) : parse(src.path, src.text);
    for (const sym of parsed.symbols) declaredNames.add(sym.name);

    if (isGeneratedSource(src.text)) continue;
    if (isTestSourceSet(src.path, input.testSourceSets)) continue;
    const ignoreMarked = src.text.includes(IGNORE_MARKER);

    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const lastLine = lineStarts.length - 1;
    const annotations = collectAnnotationExtents(clean);
    const filePool: PoolNode[] = [];

    for (const sym of parsed.symbols) {
      const row = rowByKey.get(rowKey(src.path, sym.line, sym.name));
      if (!row || isGuarded(row.outcome)) continue;
      const reject = (outcome: string) =>
        poolRejections.push({ name: sym.name, container: row.container, path: src.path, line: sym.line, outcome });

      if (ignoreMarked) { reject('I2:ignore-marker'); continue; }

      // I2, positional pass: rejectionReason checks F3:duplicate-name BEFORE
      // F5, so a duplicated @Component interface reaches us with F3 — which
      // this detector deliberately keeps eligible. Re-checking annotations by
      // position is immune to guard ordering (and to any parser window).
      const nameOffset = lineStarts[sym.line] + sym.character;
      const foreign = foreignAnnotationFor(clean, annotations, nameOffset, lineStarts, sym.line);
      if (foreign !== null) { reject(`I2:@${foreign}`); continue; }

      const spanKind = SPAN_KIND[sym.kind];
      if (!spanKind) { reject('I3:refused-extent'); continue; }
      let span = declarationSpan(clean, lineStarts, {
        kind: spanKind, name: sym.name, line: sym.line, nameOffset, lastLine,
      });
      // A bodyless fun (interface method, abstract member) has no `[{=]` for
      // declarationSpan to anchor on. Its SIGNATURE is still its own text —
      // parameter types and defaults die with it — so fall back to
      // name-through-closing-paren-line, which cannot reach a neighbor.
      if (!span && spanKind === 'fun') span = signatureOnlySpan(clean, lineStarts, nameOffset, sym.name);
      if (!span) { reject('I3:refused-extent'); continue; }

      // Hard clamp: declarationSpan on a bodyless fun grabs the next `{` in
      // reach, which can belong to the NEXT declaration — an over-wide extent
      // is the one error that swallows a live mention. Any extent crossing a
      // following same-or-shallower declaration is refused, never trimmed.
      const intruder = parsed.symbols.find(other =>
        other !== sym && other.depth <= sym.depth
        // A primary-ctor param sits at its class's own brace depth: not an intruder.
        && !other.isPrimaryCtorParam
        && (other.line > sym.line || (other.line === sym.line && other.character > sym.character))
        && lineStarts[other.line] + other.character < span.scanEnd
        && lineStarts[other.line] + other.character > nameOffset);
      if (intruder) { reject('I3:refused-extent'); continue; }

      let removeStart = -1;
      let removeEnd = -1;
      try {
        const extent = removalExtent(src.text, clean, lineStarts, lastLine, sym as RawSymbol, span);
        removeStart = extent.removeStart;
        removeEnd = extent.removeEnd;
      } catch { /* the verdict does not depend on the fix */ }

      filePool.push({
        name: sym.name, kind: sym.kind, container: row.container,
        path: src.path, line: sym.line, character: sym.character,
        scanStart: span.scanStart, scanEnd: span.scanEnd,
        removeStart, removeEnd, outcome: row.outcome,
      });
    }

    filePool.sort((a, b) => a.scanStart - b.scanStart);
    poolByFile.set(src.path, filePool);
    nodes.push(...filePool);
  }

  // A class-like node rejected for a foreign annotation takes its nested pool
  // nodes with it: the framework that instantiates the class reaches them all.
  for (const rej of poolRejections) {
    if (!rej.outcome.startsWith('I2:@')) continue;
    const filePool = poolByFile.get(rej.path);
    if (!filePool) continue;
    // No extent was computed for the rejected node, so fall back to lines: a
    // nested node declared after it in the same file is only dropped when its
    // own row named the rejected symbol in its container chain.
    for (let i = filePool.length - 1; i >= 0; i--) {
      const n = filePool[i];
      if (n.container !== null && n.container.split('.').includes(rej.name) && n.line > rej.line) {
        poolRejections.push({ name: n.name, container: n.container, path: n.path, line: n.line, outcome: rej.outcome });
        filePool.splice(i, 1);
        const globalIdx = nodes.indexOf(n);
        if (globalIdx !== -1) nodes.splice(globalIdx, 1);
      }
    }
  }

  const eligibleNames = new Set(nodes.map(n => n.name));
  const javaAccessorsByBareName = javaAccessorIndex(nodes);

  // ── Attributed harvest: same skip rules as harvestMentions, plus offsets.
  const edges = new Map<string, Set<string>>();
  const rootMain = new Map<string, string>();
  const testCounts = new Map<string, number>();
  const aliased = new Set<string>();
  const importPostings = new Map<string, { path: string; line: number }[]>();

  const addRoot = (name: string, where: string, isTest: boolean) => {
    if (!eligibleNames.has(name)) return;
    if (isTest) testCounts.set(name, (testCounts.get(name) ?? 0) + 1);
    else if (!rootMain.has(name)) rootMain.set(name, where);
  };

  for (const src of input.sources) {
    if (isBuildArtifactPath(src.path)) continue;
    if (/\.(json|lock)$/i.test(src.path)) continue;
    const isTest = isTestSourceSet(src.path, input.testSourceSets);
    const isCode = /\.(kt|kts|java)$/.test(src.path);
    const isXml = /\.xml$/.test(src.path);

    // H6: for a ServiceLoader entry the SPI name is the file name itself.
    if (/[\\/]META-INF[\\/]services[\\/]/.test(src.path)) {
      for (const token of src.path.split(/[\\/.]/)) addRoot(token, `${src.path} (service)`, isTest);
    }

    let text = src.text;
    const importLineRanges: [number, number][] = [];
    if (isCode) {
      // Comments do not count: a commented-out reference is exactly the case
      // we want reported. String contents DO count (reflection, DI by name).
      text = stripKotlinComments(text);
      // Import lines are excluded by OFFSET rather than stripImportLines,
      // which drops line bodies and would shift every extent after them.
      let offset = 0;
      let lineNumber = -1;
      for (const line of src.text.split('\n')) {
        lineNumber++;
        const end = offset + line.length + 1;
        const imp = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\s+as\s+(\w+))?/.exec(line);
        if (imp) {
          importLineRanges.push([offset, end]);
          const segments = imp[1].split('.');
          const simple = segments[segments.length - 1];
          if (eligibleNames.has(simple)) {
            const postings = importPostings.get(simple) ?? [];
            postings.push({ path: src.path, line: lineNumber });
            importPostings.set(simple, postings);
          }
          // An ALIASED import means the simple name may never appear again.
          if (imp[2]) aliased.add(simple);
          // A capitalized non-final segment is a structural dependency
          // (`import p.Outer.Nested` breaks if Outer goes). Deliberately a
          // root, never attributed: matches KJ-032 in both directions.
          for (let s = 0; s < segments.length - 1; s++) {
            if (/^[A-Z]/.test(segments[s])) addRoot(segments[s], `${src.path} (import segment)`, isTest);
          }
        }
        offset = end;
      }
    } else if (isXml) {
      text = stripXmlComments(text);
    }

    const pool = isCode && !isTest ? (poolByFile.get(src.path) ?? []) : [];
    let poolIdx = 0;
    const active: PoolNode[] = [];
    let importCursor = 0;

    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const token = m[0];
      const offset = m.index;

      while (importCursor < importLineRanges.length && importLineRanges[importCursor][1] <= offset) importCursor++;
      if (importCursor < importLineRanges.length
        && offset >= importLineRanges[importCursor][0] && offset < importLineRanges[importCursor][1]) continue;

      // I7: generated-name convention, an absolute root — the indirection
      // through build/ is beyond what attribution can prove.
      if (!declaredNames.has(token)) {
        for (const re of GENERATED_NAME_RES) {
          const g = re.exec(token);
          if (g && eligibleNames.has(g[1])) addRoot(g[1], `${src.path} (generated ${token})`, isTest);
        }
      }

      const contributions: string[] = [];
      if (eligibleNames.has(token)) contributions.push(token);
      for (const prop of accessorProperties(token)) {                     // H9
        if (eligibleNames.has(prop) && !contributions.includes(prop)) contributions.push(prop);
      }
      if (isXml) {
        // H9 reversed: a bare XML token x reaches member funs getX/setX/isX.
        const cap = token.charAt(0).toUpperCase() + token.slice(1);
        for (const prefix of ['get', 'set', 'is']) {
          if (eligibleNames.has(prefix + cap)) contributions.push(prefix + cap);
        }
      }
      // H9 reversed, Kotlin half: a bare `x` in a .kt reaches the JAVA accessor
      // `getX`/`setX`. A workspace without Java pays nothing — the index is empty,
      // and the lookup below allocates nothing per token.
      if (javaAccessorsByBareName.size > 0 && isCode && !src.path.endsWith('.java')) {
        const accessors = javaAccessorsByBareName.get(token);
        if (accessors) {
          for (const accessor of accessors) {
            if (!contributions.includes(accessor)) contributions.push(accessor);
          }
        }
      }
      if (contributions.length === 0) continue;

      let owner: PoolNode | null = null;
      if (pool.length > 0) {
        while (poolIdx < pool.length && pool[poolIdx].scanStart <= offset) { active.push(pool[poolIdx]); poolIdx++; }
        while (active.length > 0 && active[active.length - 1].scanEnd <= offset) active.pop();
        for (let i = active.length - 1; i >= 0; i--) {
          if (offset >= active[i].scanStart && offset < active[i].scanEnd) { owner = active[i]; break; }
        }
      }

      for (const name of contributions) {
        if (owner) {
          if (owner.name === name) continue;                              // self-reference
          let set = edges.get(owner.name);
          if (!set) { set = new Set(); edges.set(owner.name, set); }
          set.add(name);
        } else {
          addRoot(name, `${src.path}:${offsetToLineNumber(src.text, offset) + 1}`, isTest);
        }
      }
    }
  }

  // ── Liveness: least fixpoint from root mentions. Aliveness only grows;
  // no code path converts uncertainty into deadness.
  const aliveReason = new Map<string, string>();
  const queue: string[] = [];
  for (const [name, where] of rootMain) { aliveReason.set(name, `alive:root(${where})`); queue.push(name); }
  for (const name of aliased) {
    if (eligibleNames.has(name) && !aliveReason.has(name)) { aliveReason.set(name, 'alive:aliased-import'); queue.push(name); }
  }
  while (queue.length > 0) {
    const n = queue.pop()!;
    const out = edges.get(n);
    if (!out) continue;
    for (const x of out) {
      if (eligibleNames.has(x) && !aliveReason.has(x)) { aliveReason.set(x, `alive:via ${n}`); queue.push(x); }
    }
  }
  const deadNames = [...eligibleNames].filter(n => !aliveReason.has(n));
  const deadSet = new Set(deadNames);

  // ── Islands: weakly connected components of the mention relation
  // restricted to dead names. The unit must close both directions — users
  // will not respect a topological deletion order.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) { const next = parent.get(c)!; parent.set(c, r); c = next; }
    return r;
  };
  for (const n of deadNames) parent.set(n, n);
  for (const [owner, targets] of edges) {
    if (!deadSet.has(owner)) continue;
    for (const t of targets) if (deadSet.has(t)) parent.set(find(owner), find(t));
  }
  const components = new Map<string, string[]>();
  for (const n of deadNames) {
    const r = find(n);
    (components.get(r) ?? components.set(r, []).get(r)!).push(n);
  }

  const nodesByName = new Map<string, PoolNode[]>();
  for (const n of nodes) (nodesByName.get(n.name) ?? nodesByName.set(n.name, []).get(n.name)!).push(n);
  const isIndividuallyDead = (n: PoolNode) => /^(unreferenced|testOnly|selfOnly)$/.test(n.outcome);
  const keptAliveByOf = (name: string): string[] =>
    [...edges.entries()].filter(([o, t]) => o !== name && t.has(name) && deadSet.has(o)).map(([o]) => o).sort();

  const ignored = (m: PoolNode): boolean =>
    (input.ignoreNames ?? []).some(g =>
      matchesGlob(m.name, g) || (m.container !== null && matchesGlob(`${m.container}.${m.name}`, g)));

  const islands: DeadIsland[] = [];
  const componentOutcome = new Map<string, string>();                     // name -> outcome

  const sortedComponents = [...components.values()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const names of sortedComponents) {
    const members = names.flatMap(n => nodesByName.get(n) ?? [])
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const mark = (outcome: string) => { for (const n of names) componentOutcome.set(n, outcome); };
    if (members.length === 0) { mark('I6:subsumed'); continue; }
    if (members.every(isIndividuallyDead)) { mark('I6:subsumed'); continue; }
    if (members.length > maxIslandSize) { mark('I8:max-size'); continue; }
    if (members.some(ignored)) { mark('I2:ignored-name'); continue; }
    const testMentions = names.reduce((a, n) => a + (testCounts.get(n) ?? 0), 0);
    const verdict: DeadIslandVerdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
    if (verdict === 'testOnly' && input.includeTestOnly === false) { mark('I2:test-only-excluded'); continue; }
    islands.push({
      members: members.map(m => ({
        name: m.name, kind: m.kind, container: m.container,
        path: m.path, line: m.line, character: m.character,
        removeStart: m.removeStart, removeEnd: m.removeEnd,
        individuallyDead: isIndividuallyDead(m),
        keptAliveBy: keptAliveByOf(m.name),
      })),
      names: [...names].sort(),
      verdict,
      testMentions,
      fixable: members.every(m => m.removeStart >= 0),                    // I5
      staleImports: [...names]
        .flatMap(n => (importPostings.get(n) ?? []).map(p => ({ ...p, name: n })))
        .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    });
  }
  islands.sort((a, b) => b.members.length - a.members.length
    || a.members[0].path.localeCompare(b.members[0].path) || a.members[0].line - b.members[0].line);
  islands.forEach((isl, i) => { for (const n of isl.names) componentOutcome.set(n, `island#${i + 1}`); });

  // ── Explanations: every raw candidate accounted for, sharing the exact
  // objects the verdict used, so the two surfaces cannot disagree.
  const explanations: IslandExplanation[] = [];
  const poolKey = new Set(nodes.map(n => rowKey(n.path, n.line, n.name)));
  for (const r of rows) {
    const key = rowKey(r.path, r.line, r.name);
    if (isGuarded(r.outcome)) {
      explanations.push({ name: r.name, container: r.container, path: r.path, line: r.line, outcome: r.outcome });
      continue;
    }
    if (!poolKey.has(key)) continue;                                      // handled below via poolRejections
    const outcome = aliveReason.get(r.name) ?? componentOutcome.get(r.name) ?? 'unaccounted';
    explanations.push({ name: r.name, container: r.container, path: r.path, line: r.line, outcome });
  }
  explanations.push(...poolRejections);
  explanations.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

  return { islands, explanations };
}

/** Extent of a bodyless fun: name through the end of the closing-paren line.
 *  Under-approximates by construction — it can never grab a neighbor's body,
 *  which is what declarationSpan risks when no `[{=]` follows the signature. */
function signatureOnlySpan(
  clean: string,
  lineStarts: readonly number[],
  nameOffset: number,
  name: string,
): { scanStart: number; scanEnd: number; lineBasedEnd: boolean } | undefined {
  let i = nameOffset + name.length;
  while (i < clean.length && /\s/.test(clean[i])) i++;
  if (clean[i] !== '(') return undefined;
  const close = findMatchingParen(clean, i);
  if (close === -1) return undefined;
  let lineEnd = close;
  while (lineEnd < clean.length && clean[lineEnd] !== '\n') lineEnd++;
  return { scanStart: nameOffset, scanEnd: lineEnd, lineBasedEnd: true };
}

/**
 * Properties a spelled accessor token can reach (H9). `getFoo` reaches `foo`,
 * but an ALL_CAPS property keeps its name verbatim in its accessor:
 * `getIGNORED_CHILD_CLASSES` reaches `IGNORED_CHILD_CLASSES`, not
 * `iGNORED_CHILD_CLASSES` — the identity mapping was the one real false
 * positive of the corpus audit (a Java caller through the companion getter).
 */
/**
 * H9 reversed, Kotlin half — the rule `harvestBareKotlinMentions` applies in
 * `unusedMembers.ts`, brought to the reference graph so the two detectors stop
 * disagreeing about what reaches a Java accessor.
 *
 * Kotlin synthesises a property from a JAVA accessor, so
 * `metadata.includedProjects` is the only way a Kotlin call site can spell
 * `ProjectMetadata.getIncludedProjects()` (test/kotlin-lsp-main:
 * IdeaProjectMapper.kt:39 reads ProjectMetadata.java:30 that way).
 *
 * Restricted to Java declarations, exactly as KJ-042 does: every caller of a
 * KOTLIN `getX` spells `getX`, and a bare `x` elsewhere is an unrelated
 * variable — that restriction exists because counting it killed a real finding.
 *
 * `isX()` needs no key: the token already IS the declaration name. `setX` gets
 * two, since a Java `isX()`/`setX()` pair is one Kotlin property named `isX`
 * and its write is `f.isX = v`.
 *
 * Exported for the suite: the restriction cannot be exercised through islands,
 * because a Kotlin `getX` whose class is alive is claimed by KJ-042 first.
 */
export function javaAccessorIndex(
  nodes: readonly { name: string; kind: string; path: string }[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (bare: string, accessor: string) => {
    const known = index.get(bare);
    if (known) { if (!known.includes(accessor)) known.push(accessor); }
    else index.set(bare, [accessor]);
  };
  for (const n of nodes) {
    if (n.kind !== 'fun' || !n.path.endsWith('.java')) continue;
    const m = /^(get|set)([A-Z]\w*)$/.exec(n.name);
    if (!m) continue;
    add(m[2][0].toLowerCase() + m[2].slice(1), n.name);
    if (m[1] === 'set') add(`is${m[2]}`, n.name);
  }
  return index;
}

function accessorProperties(token: string): string[] {
  const m = /^(?:get|set|is)([A-Z]\w*)$/.exec(token);
  if (!m) return [];
  const raw = m[1];
  const decapitalized = raw[0].toLowerCase() + raw.slice(1);
  return decapitalized === raw ? [raw] : [decapitalized, raw];
}

interface AnnotationExtent { name: string; start: number; end: number; }

/** Every `@Name` / `@target:Name` with its full argument extent, from the
 *  sanitized text (length-preserving, so offsets are raw-text offsets). */
function collectAnnotationExtents(clean: string): AnnotationExtent[] {
  const out: AnnotationExtent[] = [];
  const re = /@([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    let name = m[1];
    let cursor = m.index + m[0].length;
    if (USE_SITE_TARGETS.has(name) && clean[cursor] === ':') {
      const target = /^(\w+)/.exec(clean.slice(cursor + 1));
      if (!target) continue;
      name = target[1];
      cursor += 1 + target[1].length;
    }
    let end = cursor;
    let probe = cursor;
    while (probe < clean.length && /[ \t]/.test(clean[probe])) probe++;
    if (clean[probe] === '(') {
      const close = findMatchingParen(clean, probe);
      if (close !== -1) end = close + 1;
    }
    out.push({ name, start: m.index, end });
  }
  return out;
}

/**
 * The non-benign annotation targeting the declaration at nameOffset, or null.
 * An annotation targets the next declaration when only whitespace and other
 * annotations separate them — no line-count window to overflow.
 */
function foreignAnnotationFor(
  clean: string,
  annotations: readonly AnnotationExtent[],
  nameOffset: number,
  lineStarts: readonly number[],
  line: number,
): string | null {
  const declLineStart = lineStarts[line];
  let foreign: string | null = null;
  for (const a of annotations) {
    if (a.end > declLineStart) continue;
    const between = clean.slice(a.end, declLineStart);
    let covered = true;
    let i = 0;
    while (i < between.length) {
      if (/\s/.test(between[i])) { i++; continue; }
      const abs = a.end + i;
      const inner = annotations.find(x => x.start <= abs && abs < x.end);
      if (inner) { i = inner.end - a.end; continue; }
      covered = false;
      break;
    }
    if (!covered) continue;
    if (!BENIGN_ANNOTATIONS.has(a.name)) foreign = a.name;
  }
  return foreign;
}

function offsetToLineNumber(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

export function messageFor(island: DeadIsland): string {
  const files = new Set(island.members.map(m => m.path)).size;
  const base = `Dead island: ${island.members.length} declarations across ${files} file(s) reference only each other and are referenced by nothing else`;
  if (island.verdict === 'testOnly') {
    return `${base} (referenced only from tests: ${island.testMentions} reference${island.testMentions > 1 ? 's' : ''})`;
  }
  return base;
}

export function deleteTitleFor(island: DeadIsland): string {
  return `Delete dead island (${island.members.length} declarations)`;
}
