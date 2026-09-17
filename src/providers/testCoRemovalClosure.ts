import { parse, RawSymbol } from '../indexer/KotlinParser';
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

/**
 * The WHOLE STATEMENT holding `lineNo`, as a line range, when removing it
 * leaves valid code behind; undefined when anything else depends on it.
 *
 * This replaces a one line test, and the widening is what unlocks the shared
 * base test classes. Measured on the reference project, the two uses that
 * kept `HtmlFormatterHelper` and `AnalyticsPageModel` alive are statements
 * that span three and four lines:
 *
 *   doAnswer {                                  // AssemblerBaseTest, @Before
 *       it.arguments[0]
 *   }.whenever(htmlFormatterHelper).parseHtml(any())
 *
 * The mention sits on the LAST line, so the search walks backwards to where
 * the brackets balance, then forwards to the end of the statement.
 *
 * What makes the removal safe is the shape, not the length: an EXPRESSION
 * statement's value is discarded, so nothing downstream can refer to it. A
 * statement that declares (`val x = …`), returns, or opens a branch does have
 * dependents, and is refused. An assignment is allowed only when what it
 * assigns to is `name` itself, which is leaving with it.
 */
/** Opens something that is not an expression statement, whatever follows. */
const NOT_A_STATEMENT_RE = /^(?:val|var|const|fun|return|else|do|try|catch|finally|throw|class|object|interface|enum|record|public|private|protected|internal|static|final|abstract|synchronized|companion)\b/;
/**
 * A word that opens a BRANCH in Kotlin and names a CALL in Java. Mockito's
 * `when(mock.get()).thenReturn(x)` is the most common statement in a Java
 * test file, and `when` is also Kotlin's `when (x) { … }`. Refusing the word
 * outright refused every Mockito stubbing line, which is exactly the shape
 * that has to go with a mock. What separates them is what follows the
 * parentheses: a branch opens a block, a call is chained or ends.
 */
const BRANCH_OR_CALL_RE = /^(?:if|for|while|when|switch|synchronized)\s*\(/;

/** Bracket delta of `s`, ignoring what sits in a string or a char literal. */
function delta(s: string): { net: number; lowest: number } {
  let net = 0, lowest = 0, quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') net++;
    else if (c === '}' || c === ')' || c === ']') { net--; if (net < lowest) lowest = net; }
  }
  return { net, lowest };
}

/**
 * The leftmost identifier of a statement: what it assigns to, the receiver it
 * calls a method on, or the function it calls. `components.put(x)` has subject
 * `components`, `setUpMocks()` has subject `setUpMocks`.
 */
function subjectOf(text: string): string | undefined {
  const m = /^(?:this\.)?(`[^`]+`|[A-Za-z_$][\w$]*)/.exec(text);
  return m ? m[1].replace(/`/g, '') : undefined;
}

function standaloneStatementExtent(
  lines: readonly string[],
  lineNo: number,
  name: string,
  /**
   * When set, the statement's SUBJECT must be this name. Required inside a
   * lifecycle method, and this is where the Gradle run earned its keep: two
   * tests compiled and then failed, one on a `ComparisonFailure` and one on a
   * NullPointerException, because a `@Before` lost a line that configured an
   * object the tests still used.
   *
   *   components.put(ConfigConst.LIVE_NEWS_V2_API.getValue(), live())
   *   thumbnailSpec.setOtherThumbnailToPrefetch(ThumbnailSpec(…))
   *
   * Both mention a leaving member, and both feed something that SURVIVES, so
   * every surviving test in the file observes the cut. A statement whose
   * subject is itself leaving cannot be observed by anything that stays.
   */
  subject?: string,
): { first: number; last: number } | undefined {
  if ((lines[lineNo] ?? '').trim() === '') return undefined;
  // Backwards to the line the statement opens on: the slice from there to the
  // mention must never dip below its own starting depth.
  let first = lineNo;
  for (let guard = 0; guard < 64; guard++) {
    const slice = lines.slice(first, lineNo + 1).join('\n');
    if (delta(slice).lowest >= 0) break;
    if (first === 0) return undefined;
    first--;
  }
  // Forwards to where the brackets close and the statement ends.
  let last = lineNo;
  for (let guard = 0; guard < 64; guard++) {
    const slice = lines.slice(first, last + 1).join('\n');
    if (delta(slice).net <= 0) break;
    if (last + 1 >= lines.length) return undefined;
    last++;
  }
  const text = lines.slice(first, last + 1).join('\n').trim();
  if (delta(text).net !== 0) return undefined;
  if (NOT_A_STATEMENT_RE.test(text)) return undefined;
  const branch = BRANCH_OR_CALL_RE.exec(text);
  if (branch) {
    // Skip the balanced parentheses and look at the next thing written.
    let i = text.indexOf('(', branch[0].length - 1);
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) { i++; break; }
    }
    const after = text.slice(i).trim();
    // `{` is a block, and so is a bare statement on the same line. Only a
    // chained call or the end of the statement makes it an expression.
    if (!/^(?:\.|;|$)/.test(after)) return undefined;
  }
  const n = escape(name);
  // A top level `=` is an assignment, and only an assignment TO `name` leaves
  // nothing behind. `foo(NAME) = bar` is neither shape and refuses.
  if (/^[^={}()[\]]*=[^=]/.test(text) && !new RegExp(`^(?:this\\.)?${n}\\s*=[^=]`).test(text)) return undefined;
  // One statement, not several: a `;` at depth zero before the end means the
  // line carries a neighbour that would go with it.
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) return undefined;
  }
  // The statement must mention the name, and start on its own: an expression
  // statement begins with an identifier, `this`, or a qualified receiver.
  if (!new RegExp(`\\b${n}\\b`).test(text)) return undefined;
  // An expression statement begins with an identifier, `this`, a qualified
  // receiver, or a Kotlin identifier in backticks. `\`when\`(mock.get())` is
  // how a Kotlin test calls Mockito, and requiring a word character refused
  // every one of them: it is what withheld the `AnalyticsPageModel` island.
  if (!/^(?:`[^`]+`|[\w$.]+)\s*[({.=]/.test(text)) return undefined;
  if (subject !== undefined && subjectOf(text) !== subject) return undefined;
  // The sole content of a block: `{` right above, `}` right below. Removing it
  // would leave `if (x) { }`, which compiles and silently changes nothing, or
  // a lambda with no body, which does not.
  let up = first - 1;
  while (up >= 0 && (lines[up] ?? '').trim() === '') up--;
  let down = last + 1;
  while (down < lines.length && (lines[down] ?? '').trim() === '') down++;
  if ((lines[up] ?? '').trim().endsWith('{') && (lines[down] ?? '').trim().startsWith('}')) return undefined;
  return { first, last };
}

/**
 * A Kotlin SETTER the group removes, and the property a call site can write
 * instead. Undefined when the chased name is anything else.
 *
 * Measured on the reference project: `ThumbnailSpec.setOtherThumbnailToPrefetch`
 * is called once, from a @Before, and the call feeds `thumbnailSpec`, an
 * object every test in the file still reads. Cutting the line compiles and
 * fails those tests at runtime, so the planner withholds the group, and that
 * refusal stands. The hand written branch neither cut nor kept the line: it
 * wrote `thumbnailSpec.otherThumbnailToPrefetch = new ThumbnailSpec(...)` and
 * deleted the setter. `@JvmField var` exposes the property to Java as a plain
 * field, so the assignment does exactly what the call did.
 *
 * The shape is narrow on purpose. One parameter, a body that is exactly one
 * assignment of it to a property, the property declared in the same class as
 * the setter: `fun setX(p: T) { x = p }`, `this.x` allowed, a trailing `;`
 * allowed, nothing else. What the call site may write depends on where it is
 * written: Java sees no property without `@JvmField`, only accessors; Kotlin
 * needs a `var` visible from the caller, with its default setter.
 */
interface SetterShape {
  property: string;
  javaWritable: boolean;
  kotlinWritable: boolean;
}

/**
 * `@Synchronized` makes the call take a lock the assignment would not. It is
 * the one modifier found that changes what the call does at runtime while the
 * body still reads as one assignment, so it is refused by name.
 */
const SYNCHRONIZED_RE = /@(?:kotlin\.jvm\.)?Synchronized\b/;
const RESTRICTED_SET_RE = /\b(?:private|protected|internal)\s+set\b/;

function setterShape(
  name: string,
  extents: readonly { path: string; start: number; end: number }[],
  byPath: ReadonlyMap<string, Src>,
  clean: (s: Src) => string,
): SetterShape | undefined {
  // The parameter type may carry one generic argument list; a function type
  // or a second parameter both break the match, which is the point.
  const re = new RegExp(
    `\\bfun\\s+${escape(name)}\\s*\\(\\s*([A-Za-z_]\\w*)\\s*:\\s*[^(),<>]+(?:<[^()]*>)?[^(),<>]*\\)`
    + `\\s*(?::\\s*Unit)?\\s*\\{\\s*(?:this\\.)?([A-Za-z_]\\w*)\\s*=\\s*\\1\\s*;?\\s*\\}`,
  );
  // One declaration, or no rewrite: with an overload in the same group the
  // call site may bind to the other one, whose body is not this assignment.
  const declRe = new RegExp(`\\bfun\\s+${escape(name)}\\s*\\(`, 'g');
  let declared = 0;
  for (const e of extents) {
    const src = byPath.get(e.path);
    if (src) declared += (clean(src).slice(e.start, e.end).match(declRe) ?? []).length;
  }
  if (declared !== 1) return undefined;
  for (const e of extents) {
    const src = byPath.get(e.path);
    if (!src || !e.path.endsWith('.kt')) continue;
    const text = clean(src);
    const m = re.exec(text.slice(e.start, e.end));
    if (!m) continue;
    const property = m[2];
    const funLine = offsetToPos(buildLineStarts(text), e.start + m.index).line;
    const lines = src.text.split('\n');
    // The regex reads nothing before `fun`, so what stands there is read
    // here: the extent's own head, and the annotation lines above the
    // function for a caller whose extent starts at the `fun` line.
    let locked = SYNCHRONIZED_RE.test(text.slice(e.start, e.start + m.index));
    for (let k = funLine - 1; !locked && k >= 0 && (lines[k] ?? '').trim().startsWith('@'); k--) {
      locked = SYNCHRONIZED_RE.test(lines[k] ?? '');
    }
    if (locked) continue;
    const symbols = parse(e.path, src.text).symbols;
    const fun = symbols.find(s => s.kind === 'fun' && s.name === name && s.line === funLine);
    if (!fun) continue;
    // The class a member belongs to: the last class-like declaration opened
    // one brace level above it. The parser reports a primary constructor
    // property one level below the class header, like a body member.
    const classOf = (line: number, depth: number): RawSymbol | undefined => {
      let best: RawSymbol | undefined;
      for (const s of symbols) {
        if (!CLASS_LIKE.has(s.kind) || s.depth !== depth - 1 || s.line >= line) continue;
        if (!best || s.line > best.line) best = s;
      }
      return best;
    };
    const owner = classOf(fun.line, fun.depth);
    // A property of an object is a static field to Java and a member of the
    // object to Kotlin: two spellings the rewrite does not attempt.
    if (!owner || owner.kind === 'object') continue;
    const prop = symbols.find(s => (s.kind === 'val' || s.kind === 'var') && s.name === property
      && s.depth === fun.depth && classOf(s.line, s.depth) === owner);
    if (!prop || prop.kind !== 'var') continue;
    const own = lines[prop.line] ?? '';
    const before = own.slice(0, prop.character);
    // `internal` is refused with the private ones. The module a call site
    // belongs to is not something its path proves: reading it as everything
    // before the first `src/` made every file of a checkout under `~/src` one
    // module, and nothing measured writes an internal property.
    if (/\b(?:private|protected|internal)\b/.test(before)) continue;
    // `@JvmField` sits before the name on its line, or alone on a line above.
    let jvmField = /@JvmField\b/.test(before);
    for (let k = prop.line - 1; k >= 0 && !jvmField; k--) {
      const t = (lines[k] ?? '').trim();
      if (!t.startsWith('@') || /\b(?:val|var|fun|class)\b/.test(t)) break;
      jvmField = /@JvmField\b/.test(t);
    }
    // `private set`: readable from outside, not writable. It sits on the
    // declaration, on the line below, or further down once an explicit
    // `get()` stands in between, so the accessor lines are read up to the
    // next member at the property's depth, whatever a getter body spans.
    const nextMember = Math.min(lines.length,
      ...symbols.filter(s => s.line > prop.line && s.depth <= prop.depth).map(s => s.line));
    const setterRestricted = RESTRICTED_SET_RE.test(own.slice(prop.character))
      || lines.slice(prop.line + 1, nextMember).some(l => RESTRICTED_SET_RE.test(l));
    return { property, javaWritable: jvmField, kotlinWritable: !setterRestricted };
  }
  return undefined;
}

/**
 * An assignment is a statement, never an expression, in Kotlin. A call whose
 * value is taken is therefore not rewritable: the value of `=`, `->`,
 * `return` or `else`, an argument of a call left open on the line above, or
 * the head of a chain that goes on below (`.also { }`, `?: return`).
 */
const CONTINUES_FROM_ABOVE_RE = /(?:[=(,.]|->|\?:|&&|\|\||\breturn|\belse)$/;
const CONTINUES_BELOW_RE = /^(?:\.|\?\.|\?:|!!|&&|\|\|)/;
/** `spec.setOther(spec = x)`: written as an assignment it becomes `spec.other = spec = x`. */
const NAMED_ARGUMENT_RE = /^[A-Za-z_]\w*\s*=(?!=)/;

/** The nearest line beyond `from` in direction `step` that is code, trimmed; empty at the edge. */
function neighbourCode(lines: readonly string[], from: number, step: -1 | 1): string {
  for (let k = from + step; k >= 0 && k < lines.length; k += step) {
    const t = (lines[k] ?? '').trim();
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    return t;
  }
  return '';
}

/**
 * The statement holding `lineNo` when it is exactly `recv.NAME(arg)`, with
 * the same statement written `recv.PROPERTY = arg`. Undefined for anything
 * else: no receiver, a chained call, a second statement on the line, an
 * argument that does not balance, a named argument, or a call whose value
 * the line above or below takes. Indentation, the trailing `;` and the
 * argument are kept as written, the argument across its lines.
 */
function setterCallRewrite(
  lines: readonly string[],
  lineNo: number,
  name: string,
  property: string,
): { first: number; last: number; text: string } | undefined {
  if ((lines[lineNo] ?? '').trim() === '') return undefined;
  let first = lineNo;
  for (let guard = 0; guard < 64; guard++) {
    if (delta(lines.slice(first, lineNo + 1).join('\n')).lowest >= 0) break;
    if (first === 0) return undefined;
    first--;
  }
  let last = lineNo;
  for (let guard = 0; guard < 64; guard++) {
    if (delta(lines.slice(first, last + 1).join('\n')).net <= 0) break;
    if (last + 1 >= lines.length) return undefined;
    last++;
  }
  if (CONTINUES_FROM_ABOVE_RE.test(neighbourCode(lines, first, -1))) return undefined;
  if (CONTINUES_BELOW_RE.test(neighbourCode(lines, last, 1))) return undefined;
  const stmt = lines.slice(first, last + 1).join('\n');
  const head = new RegExp(
    `^(\\s*)([A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*\\.\\s*${escape(name)}\\s*\\(`,
  ).exec(stmt);
  if (!head) return undefined;
  const open = head[0].length - 1;
  let depth = 0, close = -1, quote = '';
  for (let i = open; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1 || stmt[close] !== ')') return undefined;
  const tail = /^\s*(;?)(\s*)$/.exec(stmt.slice(close + 1));
  if (!tail) return undefined;
  const arg = stmt.slice(open + 1, close).trim();
  if (arg === '' || NAMED_ARGUMENT_RE.test(arg)) return undefined;
  const receiver = head[2].replace(/\s+/g, '');
  return { first, last, text: `${head[1]}${receiver}.${property} = ${arg}${tail[1]}${tail[2]}` };
}

/** `text` with the extents removed, or replaced when they say so, whole lines, later ones first. */
function applyInMemory(text: string, extents: readonly { start: number; end: number; replacement?: string }[]): string {
  const sorted = [...extents]
    .filter(e => e.start >= 0 && e.end > e.start)
    .sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of sorted) {
    if (e.end > lastStart) continue;          // overlap with a later cut already applied
    const w = wholeLines(out, e.start, e.end);
    out = out.slice(0, w.start) + (e.replacement ?? '') + out.slice(w.end);
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

  const addCut = (path: string, start: number, end: number, name: string, kind: TestCut['kind'], replacement?: string) => {
    const key = `${path}:${start}:${end}`;
    if (cutKeys.has(key)) return;
    cutKeys.add(key);
    let list = cutsByPath.get(path) ?? cutsByPath.set(path, []).get(path)!;
    // A rewrite inside a function that goes whole has nothing left to
    // rewrite, and two edits on nested ranges are one edit VS Code rejects.
    if (kind === 'function') {
      const nested = (c: TestCut) => c.kind === 'rewrite' && c.start >= start && c.end <= end;
      for (const c of list.filter(nested)) cutKeys.delete(`${c.path}:${c.start}:${c.end}`);
      list = list.filter(c => !nested(c));
      cutsByPath.set(path, list);
    }
    list.push(replacement === undefined ? { path, start, end, name, kind } : { path, start, end, name, kind, replacement });
    if (kind === 'function') plan.cutFunctions++;
  };

  const withhold = (why: string): ClosurePlan => { plan.withheld = why; plan.unresolved.push({ path: '', line: 0, reason: why }); return plan; };

  /**
   * The whole-line extent of the statement holding `offset`, when it can go on
   * its own. The unit a cut takes is the statement, wherever the statement
   * sits: inside a `static { … }` initializer, inside a lifecycle method, or
   * at the top of a block. Before this, a mention outside every declaration
   * took the FILE, which is what withheld every shared base test class.
   */
  const statementAt = (src: Src, offset: number, name: string, subject?: string): { start: number; end: number } | undefined => {
    const lineStarts = buildLineStarts(clean(src));
    const lines = src.text.split('\n');
    const ln = offsetToPos(lineStarts as number[], offset).line;
    const ext = standaloneStatementExtent(lines, ln, name, subject);
    if (!ext) return undefined;
    return wholeLines(src.text, lineStarts[ext.first],
      lineStarts[ext.last] + (lines[ext.last] ?? '').length + 1);
  };

  /**
   * The assertion statement holding `offset` inside test function `owner`,
   * when the function keeps at least one other assertion that names nothing
   * being removed; undefined otherwise. An assertion is a standalone
   * statement whose subject is a verifying call.
   */
  const ASSERTION_RE = /^(?:verify|coVerify|verifyOrder|verifySequence|verifyAll|confirmVerified|assert\w*|check|expect\w*|should\w*|require\w*)$/;
  /** True when at least one @Test function of the file names nothing that leaves. */
  const testsOtherThings = (src: Src, funs: readonly { start: number; end: number }[]): boolean => {
    const text = clean(src);
    const leaving = new RegExp(`\\b(?:${wanted.map(escape).join('|')})\\b`);
    return funs.some(f => !leaving.test(text.slice(f.start, f.end)));
  };
  const assertionAt = (src: Src, offset: number, name: string, owner: { start: number; end: number }): { start: number; end: number } | undefined => {
    const lineStarts = buildLineStarts(clean(src));
    const lines = src.text.split('\n');
    const ln = offsetToPos(lineStarts as number[], offset).line;
    const ext = standaloneStatementExtent(lines, ln, name);
    if (!ext) return undefined;
    const subject = subjectOf(lines.slice(ext.first, ext.last + 1).join('\n').trim());
    if (subject === undefined || !ASSERTION_RE.test(subject)) return undefined;
    // Another assertion must survive, and it must name nothing that leaves.
    const first = offsetToPos(lineStarts as number[], owner.start).line;
    const last = offsetToPos(lineStarts as number[], Math.max(owner.end - 1, 0)).line;
    const leaving = new RegExp(`\\b(?:${[...wanted, name].map(escape).join('|')})\\b`);
    let survives = false;
    for (let k = first; k <= last && !survives; k++) {
      if (k >= ext.first && k <= ext.last) continue;
      const t = (lines[k] ?? '').trim();
      const head = subjectOf(t);
      if (head !== undefined && ASSERTION_RE.test(head) && !leaving.test(t)) survives = true;
    }
    if (!survives) return undefined;
    return wholeLines(src.text, lineStarts[ext.first], lineStarts[ext.last] + (lines[ext.last] ?? '').length + 1);
  };

  /** True when `offset` in `src` falls inside one of the caller's production cuts. */
  const insideProductionCut = (src: Src, offset: number) =>
    (productionByPath.get(src.path) ?? []).some(e => offset >= e.start && offset < e.end);

  const queue = [...wanted];
  const seen = new Set<string>();
  const declsCache = new Map<string, Decl[]>();
  /**
   * The field and every standalone statement using it leave; the file stays.
   * Refuses, and cuts nothing, when any use is not a standalone line.
   */
  const cutFieldAndStatements = (src: Src, field: Decl, decls: readonly Decl[]): boolean => {
    const text = clean(src);
    const lineStarts = buildLineStarts(text);
    const lines = src.text.split('\n');
    const planned: { start: number; end: number; name: string }[] = [];
    for (const o of mentionOffsets(field.name, text)) {
      if (o >= field.start && o < field.end) continue;
      const ln = offsetToPos(lineStarts as number[], o).line;
      if (IMPORT_RE.test(lines[ln] ?? '')) continue;
      // Inside a declaration whose whole extent is already planned: fine.
      const holder = innermostAt(decls, o);
      if (holder && holder !== field && cutKeys.has(`${src.path}:${holder.start}:${holder.end}`)) continue;
      const ext = standaloneStatementExtent(lines, ln, field.name);
      if (!ext) return false;
      const w = wholeLines(src.text, lineStarts[ext.first],
        lineStarts[ext.last] + (lines[ext.last] ?? '').length + 1);
      planned.push({ start: w.start, end: w.end, name: field.name });
    }
    addCut(src.path, field.start, field.end, field.name, 'import');
    for (const c of planned) addCut(src.path, c.start, c.end, c.name, 'import');
    localNames.get(src.path)?.add(field.name) ?? localNames.set(src.path, new Set([field.name]));
    return true;
  };

  /**
   * The dedicated web around `src`: test files that name its types, and the
   * test files that name theirs, up to MAX_ISLAND files. Undefined when a
   * MAIN file names any of them, when the web is wider than the bound, or
   * when a file outside the web still names one of its types.
   */
  const MAX_ISLAND = 8;
  /**
   * Every TOP LEVEL type a MAIN source declares, with its package. Nested
   * types are left out on purpose: `NavigatorContract.View` is only ever
   * written qualified, and counting its simple name made `View` from
   * `android.view` look like project code, which withheld the GridGameTimer
   * island for naming a TextView.
   */
  let mainTypesCache: Map<string, string> | undefined;
  const mainTypes = (): Map<string, string> => {
    if (mainTypesCache) return mainTypesCache;
    mainTypesCache = new Map<string, string>();
    for (const s2 of sources) {
      if (isTestSourceSet(s2.path, testSourceSets) || !/\.(kt|kts|java)$/.test(s2.path)) continue;
      const pkg = /^\s*package\s+([\w.]+)/m.exec(s2.text)?.[1] ?? '';
      const parsed = s2.path.endsWith('.java') ? parseJava(s2.path, s2.text) : parse(s2.path, s2.text);
      for (const sym of parsed.symbols) {
        if (!CLASS_LIKE.has(sym.kind) || sym.name.length === 0 || sym.name === 'Companion') continue;
        if (((sym as any).depth ?? 0) !== 0) continue;
        if (!mainTypesCache.has(sym.name)) mainTypesCache.set(sym.name, pkg);
      }
    }
    return mainTypesCache;
  };
  /** Every top level type a TEST source declares, with its file. */
  let testTypesCache: Map<string, string> | undefined;
  const testTypes = (): Map<string, string> => {
    if (testTypesCache) return testTypesCache;
    testTypesCache = new Map<string, string>();
    for (const s2 of sources) {
      if (!isTestSourceSet(s2.path, testSourceSets) || !/\.(kt|kts|java)$/.test(s2.path)) continue;
      const parsed = s2.path.endsWith('.java') ? parseJava(s2.path, s2.text) : parse(s2.path, s2.text);
      for (const sym of parsed.symbols) {
        if (!CLASS_LIKE.has(sym.kind) || sym.name.length === 0 || sym.name === 'Companion') continue;
        if (((sym as any).depth ?? 0) !== 0) continue;
        if (!testTypesCache.has(sym.name)) testTypesCache.set(sym.name, s2.path);
      }
    }
    return testTypesCache;
  };
  /** The main file declaring `type`, once. */
  let declaringCache: Map<string, string> | undefined;
  const declaringFile = (type: string): string | undefined => {
    if (!declaringCache) {
      declaringCache = new Map();
      for (const s2 of sources) {
        if (isTestSourceSet(s2.path, testSourceSets) || !/\.(kt|kts|java)$/.test(s2.path)) continue;
        for (const t of declaredTypes(s2.path, s2.text)) if (!declaringCache.has(t)) declaringCache.set(t, s2.path);
      }
    }
    return declaringCache.get(type);
  };
  /** Files naming a type `file` declares, outside an import, other than `file` itself. */
  const usersOf = (file: Src): Set<string> => {
    const out = new Set<string>();
    for (const t of declaredTypes(file.path, file.text)) {
      for (const other of sources) {
        if (other.path === file.path || deleted.has(other.path) || !/\.(kt|kts|java)$/.test(other.path)) continue;
        const oc = clean(other);
        const hits = mentionOffsets(t, oc);
        if (hits.length === 0) continue;
        const os = buildLineStarts(oc);
        const ol = other.text.split('\n');
        if (hits.some(h => !IMPORT_RE.test(ol[offsetToPos(os as number[], h).line] ?? ''))) out.add(other.path);
      }
    }
    return out;
  };
  /**
   * The main types a test file names outside an import, other than those
   * being removed. `AssemblerBaseTest` is extended by eleven classes that name
   * live assemblers; `GridGameTimerTest` names only `GridGameTimerRules`,
   * which nothing else names, so the island may take it too.
   */
  const mainTypesNamedBy = (other: Src): string[] => {
    const oc = clean(other);
    const os = buildLineStarts(oc);
    const ol = other.text.split('\n');
    const wantedSet = new Set(wanted);
    // What this file imports, by simple name: an `import android.view.View`
    // says the `View` it writes is not the project's.
    const imported = new Map<string, string>();
    for (const m of other.text.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;?\s*$/gm)) {
      const q = m[1];
      const simple = q.slice(q.lastIndexOf('.') + 1);
      imported.set(simple, q.slice(0, q.lastIndexOf('.')));
    }
    const out: string[] = [];
    for (const [t, pkg] of mainTypes()) {
      if (wantedSet.has(t)) continue;
      const from = imported.get(t);
      if (from !== undefined && from !== pkg) continue;
      if (mentionOffsets(t, oc).some(h => !IMPORT_RE.test(ol[offsetToPos(os as number[], h).line] ?? ''))) out.push(t);
    }
    return out;
  };
  const insidePlannedCut = (path: string, offset: number): boolean =>
    (cutsByPath.get(path) ?? []).some(c => offset >= c.start && offset < c.end);
  const expandIsland = (src: Src): Set<string> | undefined => {
    const island = new Set<string>([src.path]);
    const frontier = [...declaredTypes(src.path, src.text)];
    const seenTypes = new Set<string>();
    while (frontier.length > 0) {
      const t = frontier.shift()!;
      if (seenTypes.has(t)) continue;
      seenTypes.add(t);
      for (const other of sources) {
        if (island.has(other.path) || deleted.has(other.path)) continue;
        if (!/\.(kt|kts|java)$/.test(other.path)) continue;
        const oc = clean(other);
        const hits = mentionOffsets(t, oc);
        if (hits.length === 0) continue;
        const os = buildLineStarts(oc);
        const ol = other.text.split('\n');
        if (hits.every(h => IMPORT_RE.test(ol[offsetToPos(os as number[], h).line] ?? ''))) continue;
        // A MAIN file joins only when it is dead with the island: every file
        // naming its types is already a member. That is the orphan the hand
        // written branch left behind on `GridGameTimerRules`, taken here with
        // the timer, its double and its test.
        const admitMain = (mainPath: string): boolean => {
          if (island.has(mainPath)) return true;
          const mf = byPath.get(mainPath);
          if (!mf) return false;
          // A main file that declares nothing and names the island is a
          // consumer of it, not a member dead with it: `val d = ResizeDouble()`
          // at the top of a main file is live code reaching into a test.
          if (declaredTypes(mainPath, mf.text).length === 0) return false;
          const users = usersOf(mf);
          for (const u of users) if (!island.has(u) && u !== other.path) return false;
          island.add(mainPath);
          frontier.push(...declaredTypes(mainPath, mf.text));
          return true;
        };
        if (!isTestSourceSet(other.path, testSourceSets)) {
          if (!admitMain(other.path)) return undefined;
        } else {
          for (const m of mainTypesNamedBy(other)) {
            const f = declaringFile(m);
            if (f === undefined || !admitMain(f)) return undefined;
          }
          island.add(other.path);
          frontier.push(...declaredTypes(other.path, other.text));
          // The other direction, the one the hand written branch missed on
          // `GridGameTimerRules`: a test type this file USES, whose every user
          // is already in the island, is dead with it. A helper shared with
          // tests outside the island keeps its users and simply stays.
          const oc2 = clean(other);
          const os2 = buildLineStarts(oc2);
          const ol2 = other.text.split('\n');
          for (const [t, file] of testTypes()) {
            if (island.has(file) || deleted.has(file) || file === other.path) continue;
            if (!mentionOffsets(t, oc2).some(h => !IMPORT_RE.test(ol2[offsetToPos(os2 as number[], h).line] ?? ''))) continue;
            const dep = byPath.get(file);
            if (!dep) continue;
            const users = usersOf(dep);
            let orphanWithIsland = true;
            for (const u of users) if (!island.has(u)) { orphanWithIsland = false; break; }
            if (!orphanWithIsland) continue;
            island.add(file);
            frontier.push(...declaredTypes(file, dep.text));
          }
        }
        if (island.size > MAX_ISLAND) return undefined;
      }
    }
    return island;
  };

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
  /**
   * Files OTHER than `src` that still name `member`, outside an import and
   * outside a cut already planned. Empty means the member is not part of what
   * the file shares, whatever else the file shares.
   *
   * THE GUARD THIS REPLACES asked about the FILE: a test file other files use
   * is infrastructure, so do not cut inside it. That was too coarse, and it is
   * what withheld all nine remaining groups on the reference project. What the
   * guard protects against is a cut reaching code the closure cannot see, and
   * that can only happen through a name another file writes. `AssemblerBaseTest`
   * is extended by twenty six classes, and not one of them names
   * `htmlFormatterHelper`: the field is private surface in a shared file, and
   * cutting it is exactly as safe as cutting it in a dedicated one.
   *
   * Every source is searched, not only Kotlin and Java: a `-keep` rule naming
   * the member, or an XML attribute, is a dependent too.
   */
  const memberHolders = (src: Src, member: string): string[] => {
    const out: string[] = [];
    for (const other of sources) {
      if (other.path === src.path || deleted.has(other.path)) continue;
      const oc = clean(other);
      const hits = mentionOffsets(member, oc);
      if (hits.length === 0) continue;
      const os = buildLineStarts(oc);
      const ol = other.text.split('\n');
      if (hits.some(h => !IMPORT_RE.test(ol[offsetToPos(os as number[], h).line] ?? '')
        && !insidePlannedCut(other.path, h))) out.push(other.path);
    }
    return out;
  };

  /** Names cut inside a test file, chased only within that file. */
  const localNames = new Map<string, Set<string>>();
  const localQueue: { path: string; name: string }[] = [];
  /**
   * Everything the plan removes so far, whatever the file: the subjects, the
   * test types deleted whole, and the helpers cut in ANY test file. A rewrite
   * keeps its argument verbatim, and that argument may call a helper cut in
   * another file: `spec.setOther(primed())` with `primed` a fixture cut in
   * Fixtures.kt closed and did not compile. The per file check below reads
   * only the file's own local names, so a rewrite is measured against all.
   */
  const leavingNames = (): string[] =>
    [...wanted, ...removedTypes, ...[...localNames.values()].flatMap(s => [...s])];
  const mentionedIn = (text: string, names: readonly string[]): string | undefined => {
    const c = sanitizeForUsageScan(text);
    return names.find(n => mentionOffsets(n, c).length > 0);
  };
  let rounds = 0;
  while (queue.length > 0) {
    if (++rounds > MAX_ROUNDS * 50) return withhold('closure did not settle');
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const isProductionName = wanted.includes(name);
    // A setter of the shape `fun setX(p: T) { x = p }` has call sites that
    // can be REWRITTEN as the assignment rather than cut.
    const setter = isProductionName ? setterShape(name, productionExtents, byPath, clean) : undefined;

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
        // A line already planned to go carries nothing to place. Without this
        // the `resize = Resize()` line cut with its field was met again as a
        // mention of `Resize` inside a @Before, and took the lifecycle path.
        if (insidePlannedCut(src.path, o)) continue;
        const line = offsetToPos(lineStarts as number[], o).line;
        if (IMPORT_RE.test(lines[line] ?? '')) {
          const w = wholeLines(src.text, lineStarts[line], lineStarts[line] + (lines[line] ?? '').length + 1);
          addCut(src.path, w.start, w.end, name, 'import');
          continue;
        }
        // Before the test function, the lifecycle method and the initialiser
        // below: `recv.setX(v)` written `recv.x = v` changes nothing at
        // runtime, so it is the smallest edit wherever the statement sits.
        // Cutting the line instead would leave `recv`, which survives,
        // without its value. What the closure has to prove is `v`: it is
        // kept as written, so it must name nothing the plan cuts.
        if (setter !== undefined) {
          const writable = src.path.endsWith('.java') ? setter.javaWritable : setter.kotlinWritable;
          const r = writable ? setterCallRewrite(lines, line, name, setter.property) : undefined;
          // Refused when the argument names a helper already cut; a helper
          // cut later is caught by the check on every rewrite at the end.
          if (r && mentionedIn(r.text, leavingNames()) === undefined) {
            const w = wholeLines(src.text, lineStarts[r.first], lineStarts[r.last] + (lines[r.last] ?? '').length + 1);
            const newline = src.text.slice(w.start, w.end).endsWith('\n') ? '\n' : '';
            addCut(src.path, w.start, w.end, name, 'rewrite', r.text + newline);
            continue;
          }
        }
        const owner = funs.find(f => o >= f.start && o < f.end);
        if (owner) {
          // One ASSERTION of a test that asserts other things: the statement
          // goes, the test stays. Measured on the reference project, a test of
          // the newsletter events verified two posts, one of them the removed
          // event's; taking the function lost a live test, and the hand
          // written branch had removed one `verify` line. A test left with no
          // assertion at all would pass for nothing, so it goes whole as before.
          // Only in a file that tests OTHER things too: a dedicated test file
          // whose every function names what leaves goes whole, as the hand
          // written branch did with `ViewUtilsTest` and `ReplicaConstTest`,
          // where each function also carried an incidental assertion that
          // would have kept a hollow test alive.
          const st = testsOtherThings(src, funs) ? assertionAt(src, o, name, owner) : undefined;
          if (st) { addCut(src.path, st.start, st.end, name, 'import'); continue; }
          addCut(src.path, owner.start, owner.end, owner.name, 'function');
          continue;
        }
        // Outside every @Test function. The first draft took the file whole
        // here, and deleted `BaseLoginViewModelPopupModelTest` (7 tests) where
        // the hand written branch removed one: the mention sat in a helper of
        // a nested test double. The helper goes, its name joins the queue, and
        // the one test that calls it goes on the next round. Only a mention
        // the top level class itself holds (its header, a constructor
        // parameter) takes the file whole.
        const inner = innermostAt(decls, o);
        if (inner === undefined || (inner.kind === 'classLike' && inner.depth === 0)) {
          // Outside every declaration: a class initializer, or a field's own
          // initialiser line. The unit is the STATEMENT when the statement can
          // go alone, and only then the file. `MockAnalyticsDataUtils` keeps
          // its mocks in a `static { … }` block, which no parser reports as a
          // declaration, so the whole file was the only answer available.
          const st = statementAt(src, o, name, name);
          if (st) { addCut(src.path, st.start, st.end, name, 'import'); continue; }
          whole = true; continue;
        }
        // A lifecycle method runs without a caller, so cutting it whole leaves
        // the tests it served to fail at RUNTIME, which no compilation catches.
        // One statement of it can still go: that is a body the framework still
        // runs, minus a line about something that no longer exists.
        if (inner.lifecycle) {
          const st = statementAt(src, o, name, name);
          if (st) { addCut(src.path, st.start, st.end, name, 'import'); continue; }
          whole = true; continue;
        }
        // A class-level declaration is about to go. If OTHER files use what
        // this file declares, this file is shared infrastructure, and a cut
        // inside it reaches code the closure cannot see: the first draft cut
        // `ready()` out of a base class and left the subclass calling it.
        //
        // Measured on the reference project, the shared files split two ways,
        // and each gets its own attempt before the group is withheld:
        //   a FIELD whose every other use in the file is one standalone
        //   statement (`htmlFormatterHelper = HtmlFormatterHelper()` in a
        //   @Before): the field and those lines go, the file stays;
        //   a DEDICATED WEB of test files that only name each other
        //   (`GridGameTimer4Test extends GridGameTimer`, `GridGameTimerTest`
        //   using the double): the whole web goes, as one island across the
        //   test boundary. `AssemblerBaseTest`, extended by eleven test
        //   classes that test other things, fits neither and stays withheld.
        const user = usedByOtherFiles(src);
        if (user !== undefined) {
          if (inner.kind === 'prop' && !inner.lifecycle && cutFieldAndStatements(src, inner, decls)) continue;
          // The member surface: what the file shares is its types and the
          // members other files name. A member no other file names is not
          // shared, and the file being shared says nothing about it.
          if (memberHolders(src, inner.name).length === 0) {
            addCut(src.path, inner.start, inner.end, inner.name, inner.kind === 'fun' ? 'function' : 'import');
            localNames.get(src.path)?.add(inner.name) ?? localNames.set(src.path, new Set([inner.name]));
            localQueue.push({ path: src.path, name: inner.name });
            continue;
          }
          const island = expandIsland(src);
          if (island !== undefined) {
            for (const f of island) {
              deleted.add(f);
              cutsByPath.delete(f);
              for (const t of declaredTypes(f, byPath.get(f)!.text)) { removedTypes.add(t); queue.push(t); }
            }
            whole = false;
            break;
          }
          return withhold(`test file ${src.path} declaring ${declaredTypes(src.path, src.text).join(', ')} is used by ${user}`);
        }
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
      if (user !== undefined) {
        // `ResizeDouble : Resize()` and the test that uses the double: an
        // island across the test boundary, reached from the class header.
        const island = expandIsland(src);
        if (island === undefined) return withhold(`test file ${src.path} declaring ${types.join(', ')} is used by ${user}`);
        for (const f of island) {
          deleted.add(f);
          cutsByPath.delete(f);
          for (const t of declaredTypes(f, byPath.get(f)!.text)) { removedTypes.add(t); queue.push(t); }
        }
        continue;
      }
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
        // One line of it, when the line is the whole call: `setUpPageDataModelMocks();`
        // inside a `@Before setup()` is a statement about something leaving,
        // and the rest of the setup still has to run.
        const st = statementAt(src, o, name, name);
        if (st) { addCut(p, st.start, st.end, name, 'import'); continue; }
        const user = usedByOtherFiles(src);
        if (user !== undefined) return withhold(`test file ${p} is shared with ${user} and its lifecycle method names ${name}`);
        deleted.add(p); cutsByPath.delete(p);
        for (const t of declaredTypes(p, src.text)) { removedTypes.add(t); queue.push(t); }
        break;
      }
      // The surface question again, one link further down the chain. The
      // first draft asked it only where the chase STARTED, so in a shared
      // file the field went, the helper using it went, and the subclass
      // calling that helper was never looked at: `ready()` was cut out of
      // `BaseTest` while `OtherTest` still called it.
      const holders = memberHolders(src, inner.name);
      if (holders.length > 0 && usedByOtherFiles(src) !== undefined) {
        return withhold(`${inner.name} in shared test file ${p} is used by ${holders[0]}`);
      }
      addCut(p, inner.start, inner.end, inner.name, inner.kind === 'fun' ? 'function' : 'import');
      localNames.get(p) ?? localNames.set(p, new Set());
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
  // The rewritten lines once more, against the names cut in EVERY file: the
  // loop above measures a file against its own local names, and a rewrite
  // keeps an argument that may call a helper cut elsewhere.
  const leaving = leavingNames();
  for (const cut of [...cutsByPath.values()].flat()) {
    if (cut.kind !== 'rewrite' || cut.replacement === undefined) continue;
    const n = mentionedIn(cut.replacement, leaving);
    if (n !== undefined) return withhold(`${n} still mentioned in the rewritten ${cut.path}`);
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
