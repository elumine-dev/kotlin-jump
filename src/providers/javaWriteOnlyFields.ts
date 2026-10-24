import { sanitizeJavaForUsageScan } from '../util/kotlinScan';

/**
 * G50: a private Java field that is written and never read.
 *
 * KJ-028 only knew Kotlin, and the Java sweep returned before it. On the
 * reference project `PageDownloadEvent.sectionProgress` is `private final`,
 * written once in the constructor from the parameter of the same name, and
 * read nowhere; three others were removed by hand with their assignment.
 *
 * Private only: a file then holds every write and every read. Each mention
 * outside the declaration must be a write, `this.f = ...` or a bare `f = ...`
 * where no parameter of that name shadows the field. A bare mention inside a
 * method whose parameter has that name is the parameter, not the field. A
 * method that declares a local of that name gives up, since the local's scope
 * is not tracked. Anything else is a read: `f++`, `f += 1`, `this.f` read,
 * `other.f`, a comparison.
 *
 * Out of reach by design: a file that serializes or reflects (Gson, Room,
 * Parcelable, `getDeclaredFields`, `reflectionToString`), a class with a
 * `native` method (JNI reads fields by name), an annotated field, a class
 * with no method but its constructors (a data carrier), and a field assigned
 * from `new`, which may hold the only strong reference to it.
 *
 * Accepted limit, as in IntelliJ's own inspection: a class with methods whose
 * private fields a serializer in another file reads (Gson behind Retrofit, a
 * test's Whitebox) is reported.
 *
 * A write that is not a whole statement on its own lines makes the field
 * unreported, never half fixed.
 */

export interface WriteOnlyField {
  name: string;
  line: number;
  character: number;
  edits: { start: number; end: number; text: string }[];
}

const OUT_OF_REACH_RE = /\b(?:Serializable|Parcelable|Externalizable|getDeclaredFields?|getFields?|reflect\w*|native|Gson|ObjectMapper|Moshi|lombok|FieldUpdater|VarHandle|MethodHandles)\b|@(?:Entity|Keep|SerializedName|Expose|Json\w*|Bindable|Parcel|Getter|Setter|Data|Value|Builder|With|AllArgsConstructor|RequiredArgsConstructor)\b/;
/** An assignment, compound assignment or increment: a side effect a deleted line would lose. */
const SIDE_EFFECT_RE = /\+\+|--|(?<![=!<>])=(?!=)/;
/** One private field declarator alone on its line, without an annotation. */
const FIELD_RE = /^([ \t]*)((?:(?:private|static|final|transient|volatile)\s+)+)([\w$<>[\].?,\s]+?)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*([^;]*))?;[ \t]*$/gm;
const METHOD_HEADER_RE = /\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:throws\s+[\w$.,\s]+)?\{/g;
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try', 'return', 'new']);
const STATEMENT_KEYWORDS = new Set(['return', 'throw', 'else', 'case', 'new', 'yield', 'assert']);

interface Method { name: string; headerStart: number; bodyStart: number; bodyEnd: number; params: Set<string>; locals: Set<string> }

function matchingBrace(clean: string, open: number): number {
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}' && --depth === 0) return i;
  }
  return clean.length;
}

function matchingParen(clean: string, open: number): number {
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '(') depth++;
    else if (clean[i] === ')' && --depth === 0) return i;
  }
  return clean.length;
}

function methodsOf(clean: string): Method[] {
  const out: Method[] = [];
  METHOD_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_HEADER_RE.exec(clean)) !== null) {
    if (NOT_A_METHOD.has(m[1])) continue;
    // `new Base(size) {` opens an anonymous class: `size` there is an argument.
    if (/\bnew\s+[\w$.]*$/.test(clean.slice(0, m.index))) continue;
    const open = m.index + m[0].length - 1;
    const end = matchingBrace(clean, open);
    const params = new Set(m[2].split(',').map(p => /([A-Za-z_$][\w$]*)\s*$/.exec(p.trim())?.[1]).filter((x): x is string => !!x));
    const locals = new Set<string>();
    const body = clean.slice(open + 1, end);
    for (const l of body.matchAll(/(?:^|[;{}(]\s*)(?:final\s+)?([A-Za-z_$][\w$<>[\].?,]*)\s+([a-z_$][\w$]*)\s*(?:=|;|:)/gm)) {
      if (!STATEMENT_KEYWORDS.has(l[1])) locals.add(l[2]);
    }
    out.push({ name: m[1], headerStart: m.index, bodyStart: open + 1, bodyEnd: end, params, locals });
  }
  return out;
}

/** The innermost method or constructor whose body holds `offset`. */
function enclosing(methods: readonly Method[], offset: number): Method | undefined {
  let best: Method | undefined;
  for (const m of methods) {
    if (offset < m.bodyStart || offset >= m.bodyEnd) continue;
    if (!best || m.bodyEnd - m.bodyStart < best.bodyEnd - best.bodyStart) best = m;
  }
  return best;
}

/** `start..end` widened to whole lines, or undefined when other code shares them. */
function wholeLines(text: string, start: number, end: number): { start: number; end: number } | undefined {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const lineEnd = nl === -1 ? text.length : nl + 1;
  if (text.slice(lineStart, start).trim() !== '' || text.slice(end, lineEnd).trim() !== '') return undefined;
  return { start: lineStart, end: lineEnd };
}

export function findJavaWriteOnlyFields(text: string): WriteOnlyField[] {
  const clean = sanitizeJavaForUsageScan(text);
  if (OUT_OF_REACH_RE.test(clean)) return [];
  const methods = methodsOf(clean);
  const classes = classesOf(clean);
  const classNames = new Set(classes.map(c => c.name));
  const out: WriteOnlyField[] = [];

  FIELD_RE.lastIndex = 0;
  let f: RegExpExecArray | null;
  while ((f = FIELD_RE.exec(clean)) !== null) {
    if (!/\bprivate\b/.test(f[2])) continue;
    // `private int a, b;`: the comma outside `<>` splits two declarators.
    if (`${f[3]} ${f[5] ?? ''}`.replace(/<[^<>]*>/g, '').replace(/<[^<>]*>/g, '').includes(',')) continue;
    const name = f[4];
    const declStart = f.index;
    const declEnd = f.index + f[0].length;
    // An annotation on the line above, nested parentheses and multi-line
    // forms included: no Java statement ends a line on `)`.
    const previousLine = clean.slice(0, declStart).trimEnd().split('\n').pop()!.trim();
    if (previousLine.startsWith('@') || previousLine.endsWith(')')) continue;
    const declClass = innermostClass(classes, declStart);
    if (f[5] !== undefined && (/\(/.test(f[5]) || SIDE_EFFECT_RE.test(f[5]))) continue;
    // A field named whole in a string is reached by name: an updater, a
    // reflective lookup, a binding expression.
    if (text.includes(`"${name}"`)) continue;
    if (enclosing(methods, declStart)) continue;
    // Fields and constructors only: a data carrier that a serializer reads
    // from another file (Gson behind Retrofit names nothing here).
    if (declClass && !methods.some(h => !classNames.has(h.name) && h.headerStart >= declClass.bodyStart && h.headerStart < declClass.bodyEnd)) continue;

    const edits: WriteOnlyField['edits'] = [];
    let writes = 0;
    let alive = false;
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    let m: RegExpExecArray | null;
    while (!alive && (m = re.exec(clean)) !== null) {
      if (m.index >= declStart && m.index < declEnd) continue;
      // The parameter's own declaration, in the header of the method it shadows.
      if (methods.some(h => m!.index >= h.headerStart && m!.index < h.bodyStart && h.params.has(name))) continue;
      const before = clean.slice(0, m.index);
      const viaThis = /\bthis\s*\.\s*$/.test(before);
      if (!viaThis && /\.\s*$/.test(before)) { alive = true; break; }
      const method = enclosing(methods, m.index);
      // A bare mention in a deeper class that inherits, or an anonymous one,
      // may be a field of its superclass: `class In extends Base { f = 1; }`.
      // `this.f` there names that class's own or inherited field, never ours.
      const useClass = innermostClass(classes, m.index);
      if (useClass && useClass !== declClass && (viaThis || useClass.inherits)) { alive = true; break; }
      if (!viaThis && method?.params.has(name)) continue;
      if (method?.locals.has(name)) { alive = true; break; }
      const after = clean.slice(m.index + name.length);
      const assign = /^\s*=(?!=)/.exec(after);
      if (!assign) { alive = true; break; }
      // A write must be a whole statement on its own lines.
      const stmtStart = viaThis ? before.search(/\bthis\s*\.\s*$/) : m.index;
      if (!/(?:^|[;{}])\s*$/.test(clean.slice(0, stmtStart))) { alive = true; break; }
      const semi = clean.indexOf(';', m.index + name.length + assign[0].length);
      if (semi === -1) { alive = true; break; }
      const rhs = text.slice(m.index + name.length + assign[0].length, semi).trim();
      const lines = wholeLines(text, stmtStart, semi + 1);
      if (!lines) { alive = true; break; }
      const cleanRhs = clean.slice(m.index + name.length + assign[0].length, semi).trim();
      if (SIDE_EFFECT_RE.test(cleanRhs)) { alive = true; break; }
      // A block lambda or array body: its `;` is not the statement's.
      if (cleanRhs.includes('{')) { alive = true; break; }
      // The field may be the only strong reference to what `new` built: a
      // listener held against a weak registry stops firing without it.
      if (/^new\b/.test(cleanRhs)) { alive = true; break; }
      const isCall = isWholeCall(cleanRhs);
      if (!isCall && /\(/.test(cleanRhs)) { alive = true; break; }
      const indent = text.slice(lines.start, stmtStart);
      edits.push({ start: lines.start, end: lines.end, text: isCall ? `${indent}${rhs};\n` : '' });
      writes++;
    }
    if (alive || writes === 0) continue;
    const decl = wholeLines(text, declStart + f[1].length, declEnd);
    if (!decl) continue;
    edits.push({ start: decl.start, end: decl.end, text: '' });
    const nameAt = declStart + f[0].search(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*(?:=|;)`));
    const line = text.slice(0, nameAt).split('\n').length - 1;
    const character = nameAt - (text.lastIndexOf('\n', nameAt - 1) + 1);
    out.push({ name, line, character, edits: edits.sort((a, b) => a.start - b.start) });
  }
  return out;
}

/** A whole call usable as a statement: `a.b(c).d(e)`, not `a(b) > c(d)`. */
function isWholeCall(expr: string): boolean {
  if (!/^[\w$.]+\s*\(/.test(expr) || !expr.endsWith(')')) return false;
  let depth = 0;
  for (const c of expr) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && !/[\w$.\s]/.test(c)) return false;
  }
  return depth === 0;
}

interface ClassBody { name: string; bodyStart: number; bodyEnd: number; inherits: boolean }

/** Named class bodies, and anonymous ones (`new X(...) {`), which inherit from X. */
function classesOf(clean: string): ClassBody[] {
  const out: ClassBody[] = [];
  for (const m of clean.matchAll(/\b(?:class|enum|record)\s+([\w$]+)[^{;]*\{/g)) {
    const open = m.index! + m[0].length - 1;
    out.push({ name: m[1], bodyStart: open + 1, bodyEnd: matchingBrace(clean, open), inherits: /\bextends\b/.test(m[0]) });
  }
  // Arguments may nest, `new Handler(Looper.getMainLooper()) {`: pair the parenthesis.
  for (const m of clean.matchAll(/\bnew\s+[\w$.]+\s*(?:<[^;{}()]*>\s*)?\(/g)) {
    const close = matchingParen(clean, m.index! + m[0].length - 1);
    const brace = /^\s*\{/.exec(clean.slice(close + 1));
    if (!brace) continue;
    const open = close + brace[0].length;
    out.push({ name: '', bodyStart: open + 1, bodyEnd: matchingBrace(clean, open), inherits: true });
  }
  return out;
}

function innermostClass(classes: readonly ClassBody[], offset: number): ClassBody | undefined {
  let best: ClassBody | undefined;
  for (const c of classes) {
    if (offset < c.bodyStart || offset >= c.bodyEnd) continue;
    if (!best || c.bodyEnd - c.bodyStart < best.bodyEnd - best.bodyStart) best = c;
  }
  return best;
}
