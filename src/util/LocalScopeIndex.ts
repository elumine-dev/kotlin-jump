/**
 * One forward pass over a document that answers, for any (line, col, word),
 * what `resolveLocalScope` used to compute by walking backwards from the
 * cursor: the enclosing function and the latest local binding of that name.
 *
 * The backward walk was O(distance to the enclosing `fun`) per call, and
 * O(5000 lines) when the word sat outside any function (a Koin module, a
 * design-system `object`). The semantic tokens provider calls it once per
 * reference token, so a 5000 line file cost seconds per keystroke. This
 * index is built once per document version and every query is O(nesting)
 * plus O(bindings of that name).
 *
 * Same heuristics as the walk it replaces: a line with a positive brace
 * balance opens a block; a block is a function body when the lines just
 * above its opener, up to the first `}`, declare `fun NAME(`; a line that
 * itself declares a function is its own scope (single-expression bodies).
 */

export interface LocalBinding { line: number; col: number; ord: number }

export interface LocalScopeIndex {
  readonly lines: readonly string[];
  /** Per line: line of the enclosing `fun` declaration, or -1. */
  readonly enclosingFun: Int32Array;
  /** Local val/var, for-loop and lambda bindings by name, in document order. */
  readonly bindings: ReadonlyMap<string, LocalBinding[]>;
}

// Permissive `fun NAME(` matcher: `[^(]*?` non-greedily skips the generic
// parameter list, the optional receiver and any other signature noise.
export const FUN_RE = /\bfun\b[^(]*?\b(\w+)\s*\(/;

const VAL_VAR_RE = /\b(?:val|var)\s+(\w+)\b/g;
// `for (x in xs)` and `for ((a, b) in xs)`. Also catches `for (x: T in xs)`.
const FOR_RE     = /\bfor\s*\(\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+))(?:\s*:\s*[\w<>?,\s.]+)?\s+in\b/g;
// Lambda params: `{ x ->`, `{ x, y ->`, `{ (a, b) ->`.
const LAMBDA_RE  = /\{\s*(?:\(\s*(\w+)\s*,\s*(\w+)\s*\)|(\w+)(?:\s*,\s*\w+)*)\s*->/g;

// Java: `[modifiers] Type name(` on a line that is not a statement. Control
// keywords, assignments, qualified calls and `;`-terminated lines are out.
export function isJavaMethodHeader(text: string): boolean {
  // `@SuppressWarnings("unchecked") public void foo(Bundle b) {`: the
  // annotation's own parenthesis is not the parameter list.
  const t = text.trim().replace(/^(?:@[\w.]+(?:\([^)]*\))?\s+)+/, '');
  const paren = t.indexOf('(');
  if (paren <= 0) return false;
  if (/^(?:if|for|while|switch|catch|return|new|else|do|try|throw|synchronized|case)\b/.test(t)) return false;
  if (/;\s*$/.test(t)) return false;
  const before = t.slice(0, paren).replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
  if (/[=.}]/.test(before)) return false;
  // `Type name` (generics and arrays allowed) or a constructor `public Foo`
  return /(?:^|\s)[\w$<>\[\],?]+\s+[A-Za-z_$][\w$]*$/.test(before)
    || /^(?:(?:public|protected|private)\s+)?[A-Z][\w$]*$/.test(before);
}

const JAVA_LOCAL_RE  = /\b(?!return\b|throw\b|new\b|case\b|else\b|instanceof\b|import\b|package\b|extends\b|implements\b)(?:final\s+)?[A-Za-z_$][\w$.]*(?:<[^>]*>)?(?:\[\])*\s+([A-Za-z_$][\w$]*)\s*(?=[=;:,)])/g;
const JAVA_LAMBDA_RE = /(?:\(\s*([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))*\s*\)|\b([A-Za-z_$][\w$]*))\s*->/g;

export function buildLocalScopeIndex(lines: readonly string[], language: 'kotlin' | 'java' | string = 'kotlin'): LocalScopeIndex {
  const isJava = language === 'java';
  const isHeader = (text: string) => isJava ? isJavaMethodHeader(text) : FUN_RE.test(text);
  const n = lines.length;
  const enclosingFun = new Int32Array(n).fill(-1);
  const bindings = new Map<string, LocalBinding[]>();
  let ord = 0;
  const record = (line: number, col: number, name: string) => {
    let list = bindings.get(name);
    if (!list) { list = []; bindings.set(name, list); }
    list.push({ line, col, ord: ord++ });
  };

  // Block opener line -> line of the `fun` that heads it, or -1. Probes
  // upward from the opener; a `}` on a later probe line means we would be
  // entering the previous function, so the opener is not a function body.
  const headerMemo = new Map<number, number>();
  const funHeader = (opener: number): number => {
    const memo = headerMemo.get(opener);
    if (memo !== undefined) return memo;
    let found = -1;
    for (let probe = opener; probe >= 0; probe--) {
      const text = lines[probe];
      if (isHeader(text)) { found = probe; break; }
      if (probe < opener && text.includes('}')) break;
    }
    headerMemo.set(opener, found);
    return found;
  };

  // Stack of open blocks: the line whose brace balance opened them and the
  // depth just below. A block stays a candidate for line L while its
  // `below` is under the depth at L.
  const stack: { line: number; below: number }[] = [];
  let depth = 0;

  for (let k = 0; k < n; k++) {
    const text = lines[k];
    let opens = 0, closes = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 123) opens++; else if (ch === 125) closes++;
    }
    const prev = depth;
    depth += opens - closes;
    if (depth < prev) {
      while (stack.length > 0 && stack[stack.length - 1].below >= depth) stack.pop();
    } else if (depth > prev) {
      stack.push({ line: k, below: prev });
    }

    if (isHeader(text)) {
      enclosingFun[k] = k;
    } else {
      for (let s = stack.length - 1; s >= 0; s--) {
        const f = funHeader(stack[s].line);
        if (f >= 0) { enclosingFun[k] = f; break; }
      }
    }

    let m: RegExpExecArray | null;
    if (isJava) {
      JAVA_LOCAL_RE.lastIndex = 0;
      while ((m = JAVA_LOCAL_RE.exec(text))) record(k, m.index + m[0].lastIndexOf(m[1]), m[1]);
      JAVA_LAMBDA_RE.lastIndex = 0;
      while ((m = JAVA_LAMBDA_RE.exec(text))) {
        // `case RED -> paint()` and `default -> …` are switch arms, not lambdas.
        // `case RED, GREEN -> paint()` and `default -> …` are switch arms, not
        // lambdas: nothing between `case` and here may be a `>` (an arrow).
        if (/\b(?:case|default)\b[^;{}>]*$/.test(text.slice(0, m.index))) continue;
        const names = m[3] ? [m[3]] : m[0].slice(1, m[0].indexOf(')')).split(',').map(s => s.trim()).filter(Boolean);
        for (const name of names) {
          const at = text.indexOf(name, m.index);
          if (at >= 0) record(k, at, name);
        }
      }
      continue;
    }
    VAL_VAR_RE.lastIndex = 0;
    while ((m = VAL_VAR_RE.exec(text))) record(k, m.index + m[0].indexOf(m[1]), m[1]);
    FOR_RE.lastIndex = 0;
    while ((m = FOR_RE.exec(text))) {
      const candidates = m[3] ? [m[3]] : [m[1], m[2]];
      for (const name of candidates) {
        const at = text.indexOf(name, m.index);
        if (at >= 0) record(k, at, name);
      }
    }
    LAMBDA_RE.lastIndex = 0;
    while ((m = LAMBDA_RE.exec(text))) {
      const candidates = m[3]
        ? splitTopLevel(m[0].slice(1, m[0].indexOf('->')), ',').map(s => s.trim())
        : [m[1], m[2]];
      for (const raw of candidates) {
        const name = raw.replace(/[()\s]/g, '');
        if (!name) continue;
        const at = text.indexOf(name, m.index);
        if (at >= 0) record(k, at, name);
      }
    }
  }

  return { lines, enclosingFun, bindings };
}

/** Last line of the signature that starts at `funLine`: parentheses balanced. */
export function signatureEnd(index: LocalScopeIndex, funLine: number): number {
  const lines = index.lines;
  let parens = countParens(lines[funLine]);
  let end = funLine;
  for (let i = funLine + 1; parens > 0 && i < lines.length; i++) {
    parens += countParens(lines[i]);
    end = i;
  }
  return end;
}

/**
 * Latest binding of `word` between `fromLine` and the cursor, exclusive of
 * bindings on the cursor line at or after the cursor column. Later bindings
 * shadow earlier ones, hence the last in document order wins.
 */
export function latestBinding(
  index: LocalScopeIndex,
  word: string,
  fromLine: number,
  line: number,
  col: number,
): LocalBinding | undefined {
  const list = index.bindings.get(word);
  if (!list) return undefined;
  let best: LocalBinding | undefined;
  for (const b of list) {
    if (b.line < fromLine) continue;
    if (b.line > line) break;
    if (b.line === line && b.col >= col) continue;
    best = b;
  }
  return best;
}

function countParens(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 40) n++; else if (ch === 41) n--;
  }
  return n;
}

/** Split `s` on `sep` only at top level (depth 0 of `()` / `<>` / `[]`). */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '<' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}
