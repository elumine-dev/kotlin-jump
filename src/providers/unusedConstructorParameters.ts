import { parse } from '../indexer/KotlinParser';
import {
  buildLineStarts, offsetToPos, sanitizeForUsageScan, collectAnnotationTargets,
  findCtorParen, findMatchingParen, splitParamSegments, depthZeroColon, matchBrace,
  fileOptsOut, suppressesDiagnostic, UNUSED_PARAMETER, SUPPRESS_NAMES,
} from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';

/**
 * KJ-058: a primary-constructor parameter nobody reads.
 *
 * `class Post(..., readingTime: Int? = null, audio: Audio? = null) : Base(...)`
 * where neither name appears in the supertype call, an init block, a property
 * initialiser or the body. The parameter exists only so that callers can pass
 * something that is then dropped on the floor. KJ-025 sees it inside the
 * declaring file but cannot cut it: the arguments live at the call sites, and
 * a per-file sweep has no view of them.
 *
 * This family reads the whole corpus and removes BOTH ends: the parameter's
 * line and, at every construction site, the named-argument line. It reports
 * nothing unless every site is provably safe to edit, which is what makes it
 * conservative by construction:
 *
 *   the parameter has a default, so a site that omits it stays valid;
 *   every site passes it by NAME on a line of its own, with an expression
 *   that calls nothing, so dropping the line drops no side effect;
 *   a positional argument at or past the parameter's index, an argument list
 *   that cannot be balanced, a trailing lambda, a Java constructor call, or a
 *   mention that cannot be tied to this declaration each disqualify it.
 *
 * Attribution of a site goes through the file's `package` and `import` lines
 * rather than the simple name alone. The reference project declares two
 * classes named `PostItemModel` in two packages, and a file that explicitly
 * imports one of them cannot be calling the other. A bare mention in another
 * package is the class's only when the file star-imports its package and the
 * corpus declares the name once: a file that imports neither the class nor
 * its package cannot name it bare, so such a mention is a library's or a
 * homonym's and disqualifies the parameter. An aliased import of the class
 * hides its sites under the alias and disqualifies it too.
 */

export interface ConstructorSite {
  path: string;
  /** 0-based line of the named argument. */
  line: number;
  /** Whole-line extent of the `name = expr,` argument. */
  removeStart: number;
  removeEnd: number;
}

export interface UnusedConstructorParameter {
  className: string;
  name: string;
  path: string;
  /** 0-based position of the parameter name. */
  line: number;
  character: number;
  /** Index in the primary constructor's parameter list. */
  paramIndex: number;
  /** Whole-line extent of the parameter, trailing comma included. */
  removeStart: number;
  removeEnd: number;
  /** Every construction site that passes the parameter, one line each. */
  sites: ConstructorSite[];
  /** Construction sites of the class in the corpus, passing the parameter or not. */
  siteCount: number;
}

export interface ConstructorParameterScanInput {
  sources: readonly { path: string; text: string }[];
  /** An incomplete corpus cannot prove that no site passes the parameter. */
  truncated?: boolean;
}

interface CodeFile {
  path: string;
  text: string;
  clean: string;
  lineStarts: number[];
  isJava: boolean;
  isKts: boolean;
  pkg: string;
  /** Explicit imports ending on a simple name, aliases kept. */
  imports: Map<string, { qualified: string; alias?: string }[]>;
  /** Packages imported with `.*`, the only other way to name a class bare. */
  starImports: Set<string>;
}

interface ParamCandidate {
  name: string;
  index: number;
  count: number;
  line: number;
  character: number;
  removeStart: number;
  removeEnd: number;
}

interface ClassCandidate {
  className: string;
  qualified: string;
  pkg: string;
  file: CodeFile;
  params: ParamCandidate[];
}

/** Annotations that provably neither construct the class nor read its parameters. */
const BENIGN_ANNOTATIONS = new Set([
  'Suppress', 'SuppressWarnings', 'SuppressLint', 'Deprecated', 'OptIn',
  'Immutable', 'Stable', 'RequiresApi', 'RequiresOptIn', 'Throws',
]);

/** A line that opens a new top-level declaration, so the header above it is over. */
const FRESH_DECLARATION_RE =
  /^(?:\}|@|abstract\b|actual\b|annotation\b|class\b|companion\b|const\b|data\b|enum\b|expect\b|external\b|fun\b|import\b|inline\b|inner\b|interface\b|internal\b|lateinit\b|object\b|open\b|operator\b|override\b|package\b|private\b|protected\b|public\b|sealed\b|suspend\b|typealias\b|val\b|value\b|var\b)/;

const CODE_RE = /\.(kt|kts|java)$/;

export function findUnusedConstructorParameters(input: ConstructorParameterScanInput): UnusedConstructorParameter[] {
  if (input.truncated) return [];

  const files = new Map<string, CodeFile>();
  const codeFile = (src: { path: string; text: string }): CodeFile => {
    const hit = files.get(src.path);
    if (hit) return hit;
    const clean = sanitizeForUsageScan(src.text);
    const { imports, starImports } = readImports(clean);
    const f: CodeFile = {
      path: src.path, text: src.text, clean,
      lineStarts: buildLineStarts(src.text),
      isJava: src.path.endsWith('.java'),
      isKts: src.path.endsWith('.kts'),
      pkg: /^[ \t]*package\s+([\w.]+)/m.exec(clean)?.[1] ?? '',
      imports, starImports,
    };
    files.set(src.path, f);
    return f;
  };

  const classes: ClassCandidate[] = [];
  for (const src of input.sources) {
    if (!src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path) || /[\\/](?:buildSrc|build-logic)[\\/]/.test(src.path)) continue;
    if (!src.text.includes('class ') || isGeneratedSource(src.text)) continue;
    if (fileOptsOut(src.text, UNUSED_PARAMETER)) continue;
    classes.push(...candidatesIn(codeFile(src)));
  }
  if (classes.length === 0) return [];

  const out: UnusedConstructorParameter[] = [];
  for (const cls of classes) {
    const verdict = scanSites(cls, input.sources, codeFile);
    if (!verdict) continue;
    for (const p of cls.params) {
      if (verdict.dead.has(p.name)) continue;
      out.push({
        className: cls.className, name: p.name, path: cls.file.path,
        line: p.line, character: p.character, paramIndex: p.index,
        removeStart: p.removeStart, removeEnd: p.removeEnd,
        sites: verdict.sites.get(p.name) ?? [],
        siteCount: verdict.siteCount,
      });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

function readImports(clean: string): Pick<CodeFile, 'imports' | 'starImports'> {
  const imports = new Map<string, { qualified: string; alias?: string }[]>();
  const starImports = new Set<string>();
  for (const m of clean.matchAll(/^[ \t]*import\s+(?:static\s+)?([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
    const qualified = m[1];
    const simple = qualified.slice(qualified.lastIndexOf('.') + 1);
    if (simple === '') {
      // `import com.a.*` matches up to the dot: the package is what precedes it.
      starImports.add(qualified.slice(0, -1));
      continue;
    }
    const l = imports.get(simple) ?? [];
    l.push({ qualified, alias: m[2] });
    imports.set(simple, l);
  }
  return { imports, starImports };
}

/** The classes of one Kotlin file that carry at least one parameter worth checking. */
function candidatesIn(file: CodeFile): ClassCandidate[] {
  const { text, clean, lineStarts } = file;
  const lines = text.split('\n');
  const lastLine = lines.length - 1;
  const symbols = parse(file.path, text).symbols;
  let annotations: ReturnType<typeof collectAnnotationTargets> | undefined;
  const out: ClassCandidate[] = [];

  for (const sym of symbols) {
    // Top-level only: a nested class is constructed as `Outer.Name(`, and the
    // attribution below reasons on packages, which a nested name has no
    // part in.
    if ((sym.kind !== 'class' && sym.kind !== 'sealedClass') || sym.depth !== 0) continue;
    if (sym.isExpect || sym.isActual) continue;
    const declLine = lines[sym.line] ?? '';
    if (/\b(?:value|inline|external)\s+class\b/.test(declLine)) continue;

    const nameOffset = lineStarts[sym.line] + sym.character;
    const ctorOpen = findCtorParen(clean, nameOffset + sym.name.length);
    if (ctorOpen === -1) continue;
    const ctorClose = findMatchingParen(clean, ctorOpen);
    if (ctorClose === -1) continue;
    // The signature the framework calls to inflate a view. Dropping a
    // parameter from it compiles and throws InflateException at runtime.
    if (/\bAttributeSet\b/.test(clean.slice(ctorOpen, ctorClose))) continue;

    // An annotation on the class or its constructor may mean injection,
    // reflection or code generation, all of which construct the class without
    // naming an argument. A silence request naming the diagnostic is honoured
    // the way KJ-026 honours it.
    if (annotations === undefined) annotations = collectAnnotationTargets(clean);
    const lineStart = lineStarts[sym.line];
    const onDeclaration = annotations.filter(a =>
      (a.target >= lineStart && a.target <= nameOffset)
      || (a.target > nameOffset + sym.name.length && a.target <= ctorOpen));
    let skip = false;
    for (const a of onDeclaration) {
      if (!BENIGN_ANNOTATIONS.has(a.name)) { skip = true; break; }
      if (SUPPRESS_NAMES.has(a.name) && a.argStart >= 0
        && suppressesDiagnostic(text.slice(a.argStart, a.argEnd), UNUSED_PARAMETER)) { skip = true; break; }
    }
    if (skip) continue;

    const span = declarationSpan(clean, lineStarts, {
      kind: 'classLike', name: sym.name, line: sym.line, nameOffset, lastLine,
    });
    if (!span) continue;
    // `declarationSpan` stops at the end of the line holding `)` when the
    // supertype call wraps onto the lines below and no body follows, which is
    // exactly where a parameter is read. The extent is taken as the larger of
    // the two, since over-scanning can only hide a finding, never invent one.
    const end = Math.max(span.scanEnd, extentAfterConstructor(clean, ctorClose + 1));
    // A secondary constructor delegates to the primary positionally, and
    // mapping that call is a different piece of work.
    if (/\bthis\s*\(/.test(clean.slice(ctorClose, end))) continue;
    // `Name(a, b)` is a call to `invoke`, not to the constructor, when the
    // companion declares one.
    if (/\boperator\s+fun\s+invoke\b/.test(clean.slice(ctorClose, end))) continue;

    const segs = splitParamSegments(clean, ctorOpen + 1, ctorClose, text);
    const params: ParamCandidate[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const segClean = clean.slice(seg.start, seg.end);
      if (segClean.includes('@')) continue; // annotated: codegen may read it
      const colon = depthZeroColon(clean, seg);
      if (colon === -1) continue;
      const before = clean.slice(seg.start, colon);
      if (before.includes('`') || /\b(?:vararg|override|val|var)\b/.test(before)) continue;
      const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(before);
      if (!nameMatch || nameMatch[1].startsWith('_')) continue;
      // A type never contains `=`, so the first one past the colon opens the
      // default value.
      if (!clean.slice(colon + 1, seg.end).includes('=')) continue;
      const name = nameMatch[1];
      const ownLine = wholeLineOf(file, seg);
      if (!ownLine) continue;
      // Everything the class declares after the name, the parameter's own
      // segment blanked: the other parameters' defaults, the supertype call,
      // init blocks, property initialisers, the body.
      const region = clean.slice(ctorOpen, seg.start) + ' '.repeat(seg.end - seg.start) + clean.slice(seg.end, end);
      if (new RegExp(`\\b${name}\\b`).test(region)) continue;
      const pos = offsetToPos(lineStarts, seg.start + nameMatch.index);
      params.push({
        name, index: i, count: segs.length, line: pos.line, character: pos.character,
        removeStart: ownLine.start, removeEnd: ownLine.end,
      });
    }
    if (params.length === 0) continue;
    out.push({
      className: sym.name,
      qualified: file.pkg === '' ? sym.name : `${file.pkg}.${sym.name}`,
      pkg: file.pkg, file, params,
    });
  }
  return out;
}

/**
 * Offset just past the class, read from the character after the constructor's
 * closing parenthesis: through the supertype list, to the end of the body when
 * there is one, and otherwise to the first line that opens a new declaration.
 *
 * A wrapped supertype call, `) : Base(` then one named argument per line then
 * `)`, is the shape this exists for. Nothing but a declaration can follow a
 * top-level class header, so a line that starts with neither a keyword nor an
 * annotation still belongs to the header.
 *
 * The compiler reads the first brace at depth zero after a `by` delegate as
 * the body, never as a trailing lambda of the delegate (kotlinc rejects
 * `by Runnable { } { ... }` at the second brace), so this walk reads it the
 * same way. The one delegate that carries its own brace is an anonymous
 * object, `by object : I { ... } {`, which is skipped like `declarationSpan`
 * skips it.
 */
function extentAfterConstructor(clean: string, from: number): number {
  let depth = 0;
  for (let i = from; i < clean.length; i++) {
    const c = clean[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '{' && depth <= 0) {
      const close = matchBrace(clean, i);
      if (close === -1) return clean.length;
      if (!/\bobject\b[^{}]*$/.test(clean.slice(from, i))) return close + 1;
      i = close;
    } else if (c === '\n' && depth <= 0) {
      let j = i + 1;
      while (j < clean.length && /\s/.test(clean[j])) j++;
      if (j >= clean.length) return clean.length;
      // A line ending on `by` wraps its delegate onto the next one, which may
      // start with `object`: a fresh declaration anywhere else, the header
      // here.
      const continues = /(?:[:,]|\bby)\s*$/.test(clean.slice(from, i));
      if (!continues && FRESH_DECLARATION_RE.test(clean.slice(j, j + 12))) return i + 1;
    }
  }
  return clean.length;
}

/**
 * The whole line a segment sits on, or undefined when it shares that line
 * with anything but an optional comma. Only such a segment can go as a line,
 * which is the only cut this family makes: a partial cut inside an argument
 * list would have to reason about commas on both sides.
 */
function wholeLineOf(file: CodeFile, seg: { start: number; end: number }): { start: number; end: number; line: number } | undefined {
  const { text, clean, lineStarts } = file;
  let s = seg.start;
  while (s < seg.end && /\s/.test(text[s])) s++;
  let e = seg.end;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (e <= s || text.slice(s, e).includes('\n')) return undefined;
  const line = offsetToPos(lineStarts, s).line;
  const start = lineStarts[line];
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
  if (clean.slice(start, s).trim() !== '') return undefined;
  // Comments are blank in `clean`, so a trailing comment goes with the line.
  if (!/^\s*,?\s*$/.test(clean.slice(e, end))) return undefined;
  return { start, end, line };
}

interface SiteVerdict {
  sites: Map<string, ConstructorSite[]>;
  dead: Set<string>;
  siteCount: number;
}

/**
 * Every construction site of the class in the corpus, judged parameter by
 * parameter. Undefined when something disqualifies the class as a whole: a
 * mention that cannot be read or cannot be attributed.
 */
function scanSites(
  cls: ClassCandidate,
  sources: readonly { path: string; text: string }[],
  codeFile: (src: { path: string; text: string }) => CodeFile,
): SiteVerdict | undefined {
  const name = cls.className;
  const wordRe = new RegExp(`\\b${name}\\b`);
  const declaredRe = new RegExp(
    `(?:\\b(?:class|interface|object|enum|typealias|record)\\b|@interface)\\s+${name}\\b|\\bfun\\b[^(\\n]*\\b${name}\\s*\\(`, 'g');
  const xmlInstantiatesRe = new RegExp(`<(?:[\\w.]*\\.)?${name}\\b|="(?:[\\w.$]*[.$])?${name}"`);
  const verdict: SiteVerdict = { sites: new Map(), dead: new Set(), siteCount: 0 };

  // Attribution needs to know whether the simple name is unique and which
  // packages declare it, so the declarations are counted before any site is
  // read.
  const mentioning: CodeFile[] = [];
  const declaredIn = new Map<CodeFile, number>();
  const declaringPkgs = new Set<string>();
  let declarations = 0;
  for (const src of sources) {
    if (!src.text.includes(name)) continue;
    if (!CODE_RE.test(src.path)) {
      // A keep rule, a layout tag or a manifest attribute reach the class by
      // name, through reflection this scan cannot follow. A detekt or lint
      // baseline names classes too, as element text, and constructs nothing.
      if (src.path.endsWith('.pro') ? wordRe.test(src.text) : xmlInstantiatesRe.test(src.text)) return undefined;
      continue;
    }
    const f = codeFile(src);
    if (!wordRe.test(f.clean)) continue;
    mentioning.push(f);
    const declaredHere = (f.clean.match(declaredRe) ?? []).length;
    declaredIn.set(f, declaredHere);
    declarations += declaredHere;
    if (declaredHere > 0 && f.pkg !== cls.pkg) declaringPkgs.add(f.pkg);
  }
  const declaredOnce = declarations === 1;

  for (const f of mentioning) {
    // A build script constructs nothing of the project it builds, but a
    // convention plugin might; either way its call cannot be read here.
    if (f.isKts) return undefined;
    const owner = ownership(f, cls, declaredOnce, declaringPkgs);
    // An aliased import of this class writes its sites under the alias, which
    // the bare-name scan below never meets: the file would pass with no site.
    if ((f.imports.get(name) ?? []).some(i => i.alias !== undefined && i.qualified === cls.qualified)) return undefined;
    // A file that declares the name itself, a homonym or a factory function,
    // resolves its own bare mentions to that declaration, unless it sits in
    // this class's package or imports this class as well: then a bare
    // mention has two possible meanings.
    const declaredHere = declaredIn.get(f) ?? 0;
    if (declaredHere > (f.path === cls.file.path ? 1 : 0)
      && (f.pkg === cls.pkg || (owner === 'ours' && f.imports.has(cls.className)))) return undefined;
    if (f.isJava) {
      if (owner === 'theirs' && !f.clean.includes(cls.qualified)) continue;
      // Java has no named arguments: any construction is positional.
      // A qualified name needs no import: `extends com.a.Base` and
      // `new com.a.Base<>(1, 5)` construct positionally all the same.
      if (new RegExp(`\\bnew\\s+(?:[\\w.]+\\.)?${name}\\s*[(<]|\\bextends\\s+(?:[\\w.]+\\.)?${name}\\b|\\b${name}\\s*::\\s*new\\b|\\b${name}\\s*\\(`).test(f.clean)) {
        return undefined;
      }
      continue;
    }
    if (owner === 'theirs' && !f.clean.includes(cls.qualified)) continue;
    // A constructor reference has the full signature; a typealias or an
    // aliased import hides sites under another name; a subclass without a
    // supertype call constructs through `super(...)` positionally.
    if (new RegExp(`::\\s*${name}\\b`).test(f.clean)) return undefined;
    if (new RegExp(`\\btypealias\\s+\\w+(?:<[^>]*>)?\\s*=\\s*(?:[\\w.]+\\.)?${name}\\b`).test(f.clean)) return undefined;
    if (new RegExp(`\\b${name}\\s*\\.\\s*Companion\\s*\\.\\s*invoke\\b`).test(f.clean)) return undefined;
    // `: Base<T> {`, `: com.a.Base {` and `: Base<T>, Runnable {` name the
    // supertype without calling it as much as `: Base {` does; the qualifier
    // and the type arguments must not hide the missing call.
    // An annotation may sit between the colon and the supertype (`: @Ann Base {`).
    if (/\bsuper\s*\(/.test(f.clean)
      && new RegExp(`:\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*(?:[\\w.]+\\.)?${name}\\b(?:<[^>]*>)?(?!\\s*[<(])`).test(f.clean)) return undefined;
    if (!readKotlinSites(f, cls, owner, verdict)) return undefined;
  }
  return verdict;
}

type Owner = 'ours' | 'theirs' | 'unknown';

/**
 * Whom a bare `Name` in this file belongs to.
 *
 * An explicit import wins over the package, as it does for the compiler, and
 * the package wins over a guess. A file in another package can only name the
 * class bare through a star import of its package, and even then the name is
 * this class's only when no other declaration in the corpus could own it;
 * `unknown` disqualifies as soon as such a mention constructs something.
 */
function ownership(f: CodeFile, cls: ClassCandidate, declaredOnce: boolean, declaringPkgs: ReadonlySet<string>): Owner {
  for (const imp of f.imports.get(cls.className) ?? []) {
    // An alias of this class disqualifies before this is asked; an alias of
    // a homonym leaves the bare name to the package rules below.
    if (imp.alias !== undefined) continue;
    return imp.qualified === cls.qualified ? 'ours' : 'theirs';
  }
  if (f.pkg === cls.pkg) return 'ours';
  if (declaringPkgs.has(f.pkg)) return 'theirs';
  return declaredOnce && f.starImports.has(cls.pkg) ? 'ours' : 'unknown';
}

/** False when a site cannot be read or attributed, which disqualifies the whole class. */
function readKotlinSites(f: CodeFile, cls: ClassCandidate, owner: Owner, verdict: SiteVerdict): boolean {
  const { clean, text } = f;
  const name = cls.className;
  const re = new RegExp(`\\b${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const at = m.index;
    let j = at + name.length;
    if (clean[j] === '<') {
      let depth = 0;
      while (j < clean.length) {
        const c = clean[j];
        if (c === '-' && clean[j + 1] === '>') { j += 2; continue; }
        if (c === '<') depth++;
        else if (c === '>') { depth--; j++; if (depth === 0) break; continue; }
        j++;
      }
    }
    while (clean[j] === ' ' || clean[j] === '\t') j++;
    if (clean[j] !== '(') continue;

    let k = at - 1;
    while (k >= 0 && (clean[k] === ' ' || clean[k] === '\t')) k--;
    if (clean[k] === '@') continue; // an annotation use, never a constructor
    if (clean[k] === '.') {
      // Only the fully qualified name reaches a top-level class through a
      // dot; anything else is another class's nested type or a method.
      let q = k - 1;
      while (q >= 0 && /[\w.]/.test(clean[q])) q--;
      if (clean.slice(q + 1, k) !== cls.pkg) continue;
    } else {
      const wordEnd = k + 1;
      while (k >= 0 && /\w/.test(clean[k])) k--;
      if (['class', 'interface', 'object', 'enum', 'fun'].includes(clean.slice(k + 1, wordEnd))) continue;
      if (owner === 'theirs') continue;
      if (owner === 'unknown') return false;
    }

    verdict.siteCount++;
    const close = findMatchingParen(clean, j);
    if (close === -1) return false;
    // `splitParamSegments` opens a depth on `<` that a comparison never
    // closes, so every argument after `n < 2` would merge into one and a
    // positional at the parameter's index, or its own named line, would go
    // unseen. Such a list cannot be read.
    if (clean.slice(j + 1, close).includes('<')) return false;
    const segs = splitParamSegments(clean, j + 1, close, text);

    // `: Name(` opens a supertype call and the brace after it is a class
    // body; anywhere else that brace is a trailing lambda, passed to the
    // LAST parameter.
    let p = at - 1;
    while (p >= 0 && /\s/.test(clean[p])) p--;
    const supertypeCall = clean[p] === ':' && clean[p - 1] !== '?';
    let after = close + 1;
    while (after < clean.length && (clean[after] === ' ' || clean[after] === '\t')) after++;
    const trailingLambda = clean[after] === '{' && !supertypeCall;

    let lastPositional = -1;
    const named = new Map<string, { seg: { start: number; end: number }; expr: string }>();
    for (let i = 0; i < segs.length; i++) {
      const s = clean.slice(segs[i].start, segs[i].end);
      const nm = /^\s*([A-Za-z_]\w*)\s*=(?!=)([\s\S]*)$/.exec(s);
      if (nm) named.set(nm[1], { seg: segs[i], expr: nm[2] });
      else lastPositional = i;
    }

    for (const param of cls.params) {
      if (verdict.dead.has(param.name)) continue;
      if (lastPositional >= param.index || (trailingLambda && param.index === param.count - 1)) {
        verdict.dead.add(param.name);
        continue;
      }
      const arg = named.get(param.name);
      if (!arg) continue;
      const line = wholeLineOf(f, arg.seg);
      // A call, a lambda, an index, a `!!`, an increment or a cast can do
      // something on its own; removing the line would remove that too.
      // An infix call (`ch sendTo msg`, `a shl 1`) is a call without parentheses.
      if (!line || arg.expr.trim() === '' || /[({[]|!!|\+\+|--|\bas\b|\w\s+[A-Za-z_]\w*\s+\S/.test(arg.expr)) {
        verdict.dead.add(param.name);
        continue;
      }
      const l = verdict.sites.get(param.name) ?? [];
      l.push({ path: f.path, line: line.line, removeStart: line.start, removeEnd: line.end });
      verdict.sites.set(param.name, l);
    }
  }
  return true;
}
