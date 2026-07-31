// No vscode import — mirrors KotlinParser.ts; safe to run in worker threads

import { ParsedFile, RawSymbol, SymbolKind } from './KotlinParser';

const RE_PACKAGE = /^\s*package\s+([\w.]+)/;
/**
 * Java imports. Requiring the `;` is free correctness the Kotlin version
 * cannot have. The `static` group is captured because a static import needs
 * two index entries rather than one; see the emit rules in `parseJava`.
 */
const RE_IMPORT = /^\s*import\s+(?:(static)\s+)?([\w.]+(?:\.\*)?)\s*;/;
// Same annotations KotlinParser reads, so a Java test behaves like a Kotlin
// one: Run Test lenses, deprecation hover, test discovery.
const RE_DEPRECATED = /@Deprecated\b/;
const RE_TEST       = /@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;
const RE_RUN_WITH   = /@RunWith\b/;
const RE_IGNORE     = /@(?:Ignore|Disabled)\b/;
const RE_LIFECYCLE  = /@(?:Before|After|BeforeEach|AfterEach|BeforeAll|AfterAll|BeforeClass|AfterClass)\b/;
// Handles: class, interface, enum, record, @interface (annotation type)
const RE_CLASS = /^\s*(?:(?:public|protected|private|static|abstract|final|strictfp|sealed|non-sealed)\s+)*(@?(?:class|interface|enum|record))\s+(\w+)/;
// Method/constructor: at least one explicit modifier + optional generic clause + name(
// Lazy `[^(=;\n]*?` covers all return-type shapes (including List<Map<K,V>>) without
// trying to grammar the type — it just stops at `(` or `=` or `;`.
// Requires a modifier so bare calls like `foo(` and local-var initializers don't match.
const RE_METHOD = /^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default)\s+)+(?:<[^(]*>\s+)?[^(=;\n]*?(\w+)\s*\(/;
// Package-private method: no access modifier required, but an explicit return type
// (void, a Java primitive, or an uppercase-starting type name) is required to distinguish
// method declarations from local variable declarations and method calls.
const RE_PKGPRIVATE_METHOD = /^\s*(?:(?:static|final|abstract|synchronized|native|strictfp)\s+)*(?:(?:void|boolean|byte|char|short|int|long|float|double)(?:\[\])*|[A-Z]\w*(?:<[^(]*>)?(?:\[\])*)\s+[^(=;\n]*?(\w+)\s*\(/;
// Field: at least one explicit modifier + type + name followed by = or ;
// `[^(=;\n]*?` stops at `(` so method declarations never match here.
const RE_FIELD  = /^\s*(?:(?:public|protected|private|static|final|volatile|transient)\s+)+[^(=;\n]*?(\w+)\s*[=;]/;
/**
 * Annotations written on the SAME line as the declaration they qualify:
 * `@Deprecated public void oldWay() {}`. Every declaration pattern above
 * expects a modifier first, so such a line matched nothing at all and the
 * member was never indexed. Measured on one project: 2393 occurrences.
 */
const RE_LEADING_ANNOTATIONS = /^(\s*)((?:@[\w.]+(?:\([^()]*\))?\s+)+)/;

/**
 * Blanks leading annotations, PRESERVING LENGTH so every `raw.indexOf(name)`
 * offset downstream stays valid.
 */
function stripLeadingAnnotations(raw: string): { decl: string; annotations: string } {
  const m = RE_LEADING_ANNOTATIONS.exec(raw);
  if (!m) return { decl: raw, annotations: '' };
  return {
    decl: m[1] + ' '.repeat(m[2].length) + raw.slice(m[0].length),
    annotations: m[2],
  };
}

export function parseJava(uriString: string, text: string): ParsedFile {
  const symbols: RawSymbol[] = [];
  // A Set, not an array: ten static imports from one class would otherwise
  // emit ten copies of its FQN, and `fileImports` is persisted into the
  // snapshot verbatim.
  const importSet = new Set<string>();
  let packageName = '';
  let inBlockComment = false;
  let braceDepth = 0;
  let enumBraceDepth = -1; // brace depth at which the current enum was declared; -1 = not in enum
  // A real JUnit class carries four (@RunWith @Config @LargeTest @Ignore), so
  // three would silently drop the first one.
  const annotationWindow: string[] = []; // last ≤8 annotation lines before a declaration

  const len = text.length;
  let pos     = 0;
  let lineNum = 0;

  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;

    if (nl === pos) { pos = nl + 1; lineNum++; continue; }

    let fns = pos;
    while (fns < nl && (text[fns] === ' ' || text[fns] === '\t')) fns++;
    if (fns >= nl) { pos = nl + 1; lineNum++; continue; }

    const fc  = text[fns];
    const fc1 = fns + 1 < nl ? text[fns + 1] : '';

    if (fc === '/' && fc1 === '/') { pos = nl + 1; lineNum++; continue; }

    if (fc === '/' && fc1 === '*') {
      const closePos = text.indexOf('*/', fns + 2);
      if (closePos === -1 || closePos >= nl) inBlockComment = true;
      braceDepth = countJavaBraces(text, pos, nl, braceDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      pos = nl + 1; lineNum++; continue;
    }

    if (inBlockComment) {
      const close = text.indexOf('*/', pos);
      if (close !== -1 && close < nl) inBlockComment = false;
      pos = nl + 1; lineNum++; continue;
    }

    // Fast skip — only lines starting with letter or @ can be declarations.
    // Still count braces so depth stays accurate (e.g. lines with only `}`).
    if (!JAVA_DECL_START[fc]) {
      braceDepth = countJavaBraces(text, pos, nl, braceDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      if (fc !== '@') annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    const rawLine = text.slice(pos, nl);
    // A same-line annotation both qualifies this declaration and hides it from
    // every pattern below, so feed it to the window and match on the rest.
    const { decl: raw, annotations: inlineAnnotations } = stripLeadingAnnotations(rawLine);
    if (inlineAnnotations.length > 0) annotationWindow.push(inlineAnnotations);

    if (!packageName && fc === 'p') {
      const m = RE_PACKAGE.exec(raw);
      if (m) { packageName = m[1]; pos = nl + 1; lineNum++; continue; }
    }

    // ── Imports ────────────────────────────────────────────────────────────
    // `SymbolIndex.add` reads these to build the word index that pre-filters
    // every usage search. Returning none, as this parser used to, made every
    // Java consumer of a Kotlin symbol invisible to Find Usages and left
    // Rename rewriting import lines whose bodies it never touched.
    //
    // `fc === 'i'` alone would also catch `interface`, so check the second
    // char too: parseJava runs INLINE, never in the worker pool, so its
    // per-line cost sits on the indexing critical path.
    if (fc === 'i' && fc1 === 'm') {
      const m = RE_IMPORT.exec(raw);
      if (m) {
        if (m[1] === undefined) {
          // `import a.b.C;` and `import a.b.*;` behave exactly like Kotlin.
          importSet.add(m[2]);
          // `import a.b.Outer.Inner;` names Outer too, and only the LAST
          // segment reaches the word index. Without this, a search for Outer
          // misses every file that imports one of its nested types. Java's
          // capitalisation convention is what tells a class from a package.
          const dot = m[2].lastIndexOf('.');
          if (dot > 0 && !m[2].endsWith('.*')) {
            const outer = m[2].slice(0, dot);
            const outerLast = outer.slice(outer.lastIndexOf('.') + 1);
            if (outerLast.length > 0 && outerLast[0] === outerLast[0].toUpperCase()
              && /[a-z]/.test(outerLast)) {
              importSet.add(outer);
            }
          }
        } else {
          const path = m[2];
          if (path.endsWith('.*')) {
            // `import static a.b.C.*;` brings unknown member names into scope,
            // so there is no word to index. Emit the bare class FQN instead:
            // `getFilesContainingWord` walks a nested target's ancestors, so a
            // search for `a.b.C.MAX` finds us through `byWord["C"]`. Emitting
            // `a.b.C.*` would post to `byWildcard` under a CLASS key, and that
            // map is only ever read with a PACKAGE key, so it could never be
            // found. Do not "fix" this to emit the wildcard form.
            importSet.add(path.slice(0, -2));
          } else {
            // `import static a.b.C.method;` needs both: the bare token
            // `method` appears in the body, and the file also depends on `C`.
            importSet.add(path);
            const lastDot = path.lastIndexOf('.');
            if (lastDot > 0) importSet.add(path.slice(0, lastDot));
          }
        }
        pos = nl + 1; lineNum++; continue;   // an import line holds no brace
      }
    }

    // ── Class-like declarations ────────────────────────────────────────────
    const cm = RE_CLASS.exec(raw);
    if (cm) {
      const name      = cm[2];
      const kind      = toJavaKind(cm[1]);
      const supertypes = extractJavaSupertypes(raw);
      const preClass   = raw.slice(0, raw.indexOf(name, cm.index));
      symbols.push({
        name,
        kind,
        line:        lineNum,
        character:   raw.indexOf(name, cm.index),
        isComposable: false,
        depth:       braceDepth,
        supertypes:  supertypes.length > 0 ? supertypes : undefined,
        isAbstract:  /\babstract\b/.test(preClass) || undefined,
        isPrivate:   /\bprivate\b/.test(preClass)  || undefined,
        // Class-level annotations used to be collected and then dropped, so a
        // Java JUnit class got no Run Test lens and a @Deprecated Java type no
        // hover, while their Kotlin equivalents did.
        isDeprecated: annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined,
        isTestClass:  annotationWindow.some(l => RE_RUN_WITH.test(l))   || undefined,
        isIgnored:    annotationWindow.some(l => RE_IGNORE.test(l))     || undefined,
      });
      if (kind === 'enum') {
        enumBraceDepth = braceDepth;
        // Single-line enum body — `enum Color { RED, GREEN, BLUE }`.
        // Count braces to detect this before the depth check resets enumBraceDepth.
        const nameEnd   = raw.indexOf(name, cm.index) + name.length;
        const openBrace = raw.indexOf('{', nameEnd);
        if (openBrace !== -1) {
          // Find the matching closing brace by tracking depth — lastIndexOf would
          // find the wrong brace on lines like: `enum Color { RED } class Foo {}`.
          let depth = 0, closeBrace = -1;
          for (let i = openBrace; i < raw.length; i++) {
            if (raw[i] === '{') depth++;
            else if (raw[i] === '}') { depth--; if (depth === 0) { closeBrace = i; break; } }
          }
          if (closeBrace !== -1) {
            parseEnumEntries(raw, openBrace + 1, closeBrace, lineNum, braceDepth + 1, symbols);
          }
        }
      }
      braceDepth = countJavaBraces(text, pos, nl, braceDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Enum entries ───────────────────────────────────────────────────────
    // Only active while inside the enum constant list (before the `;` terminator).
    if (enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1) {
      const em = /^\s*([A-Z][A-Z0-9_]*)/.exec(raw);
      if (em) {
        const terminated = parseEnumEntries(raw, 0, raw.length, lineNum, braceDepth, symbols);
        if (terminated) enumBraceDepth = -1; // `;` seen — methods may follow
        braceDepth = countJavaBraces(text, pos, nl, braceDepth);
        pos = nl + 1; lineNum++; continue;
      }
    }

    // ── Method / constructor declarations ─────────────────────────────────
    const mm = RE_METHOD.exec(raw);
    if (mm) {
      const parenIdx = raw.indexOf('(');
      const eqIdx    = raw.indexOf('=');
      // Skip field initializers: `private Foo foo = new Foo()` has `=` before `(`
      if (parenIdx !== -1 && (eqIdx === -1 || eqIdx > parenIdx)) {
        const name      = mm[1];
        const nameStart = raw.lastIndexOf(name, parenIdx);
        const preMod    = raw.slice(0, nameStart);
        symbols.push({
          name,
          kind:         'fun',
          line:         lineNum,
          character:    nameStart,
          isComposable: false,
          depth:        braceDepth,
          isAbstract:   /\babstract\b/.test(preMod)  || undefined,
          isDeprecated: annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined,
          isTest:       annotationWindow.some(l => RE_TEST.test(l))       || undefined,
          isIgnored:    annotationWindow.some(l => RE_IGNORE.test(l))     || undefined,
          isLifecycle:  annotationWindow.some(l => RE_LIFECYCLE.test(l))  || undefined,
          isOverride:   annotationWindow.some(l => /@Override\b/.test(l)) || undefined,
          isPrivate:    /\bprivate\b/.test(preMod)   || undefined,
        });
        braceDepth = countJavaBraces(text, pos, nl, braceDepth);
        if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
        annotationWindow.length = 0;
        pos = nl + 1; lineNum++; continue;
      }
    }

    // ── Package-private method declarations ───────────────────────────────
    // Only reached when RE_METHOD found no explicit access modifier.
    const pm2 = RE_PKGPRIVATE_METHOD.exec(raw);
    if (pm2) {
      const parenIdx = raw.indexOf('(');
      const eqIdx    = raw.indexOf('=');
      if (parenIdx !== -1 && (eqIdx === -1 || eqIdx > parenIdx)) {
        const name      = pm2[1];
        const nameStart = raw.lastIndexOf(name, parenIdx);
        const preMod    = raw.slice(0, nameStart);
        symbols.push({
          name,
          kind:         'fun',
          line:         lineNum,
          character:    nameStart,
          isComposable: false,
          depth:        braceDepth,
          isAbstract:   /\babstract\b/.test(preMod) || undefined,
          isOverride:   annotationWindow.some(l => /@Override\b/.test(l)) || undefined,
          isPrivate:    undefined, // package-private by definition
          // JUnit 5 test methods live exactly here: they carry no access
          // modifier, so missing this branch would leave the whole modern
          // test style without a Run Test lens.
          isDeprecated: annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined,
          isTest:       annotationWindow.some(l => RE_TEST.test(l))       || undefined,
          isIgnored:    annotationWindow.some(l => RE_IGNORE.test(l))     || undefined,
          isLifecycle:  annotationWindow.some(l => RE_LIFECYCLE.test(l))  || undefined,
        });
        braceDepth = countJavaBraces(text, pos, nl, braceDepth);
        if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
        annotationWindow.length = 0;
        pos = nl + 1; lineNum++; continue;
      }
    }

    // ── Field declarations ─────────────────────────────────────────────────
    const fm = RE_FIELD.exec(raw);
    if (fm && !RE_CLASS.test(raw)) {
      const name     = fm[1];
      // `lastIndexOf` up to the first = or ; to avoid picking up the wrong word
      const eqOrSemi = raw.search(/[=;]/);
      const nameIdx  = eqOrSemi !== -1 ? raw.lastIndexOf(name, eqOrSemi) : raw.lastIndexOf(name);
      if (nameIdx !== -1) {
        const preMod  = raw.slice(0, nameIdx);
        const isFinal = /\bfinal\b/.test(preMod);
        symbols.push({
          name,
          kind:         isFinal ? 'val' : 'var',
          line:         lineNum,
          character:    nameIdx,
          isComposable: false,
          depth:        braceDepth,
          isConst:      /\bstatic\b/.test(preMod) && isFinal || undefined,
          isPrivate:    /\bprivate\b/.test(preMod) || undefined,
        });
      }
      braceDepth = countJavaBraces(text, pos, nl, braceDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Annotation window ──────────────────────────────────────────────────
    if (fc === '@') {
      if (annotationWindow.length >= 8) annotationWindow.shift();
      annotationWindow.push(raw.trimStart());
    } else {
      annotationWindow.length = 0;
    }

    braceDepth = countJavaBraces(text, pos, nl, braceDepth);
    if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
    pos = nl + 1;
    lineNum++;
  }

  return { uriString, packageName, imports: [...importSet], symbols };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse enum entries from raw[from..to).
// Returns true if the `;` terminator was encountered (constant list ended).
function parseEnumEntries(
  raw: string, from: number, to: number, lineNum: number, depth: number, symbols: RawSymbol[],
): boolean {
  let parenD = 0;
  let segStart = from;
  for (let i = from; i <= to; i++) {
    const ch = i < to ? raw[i] : '\0';
    if      (ch === '(' || ch === '[') { parenD++; continue; }
    else if (ch === ')' || ch === ']') { parenD--; continue; }
    else if (parenD > 0)               { continue; }
    if (ch === ',' || ch === ';' || ch === '{' || i === to) {
      const seg = raw.slice(segStart, i);
      const sm  = /^\s*([A-Z][A-Z0-9_]*)/.exec(seg);
      if (sm) symbols.push({
        name: sm[1], kind: 'enum', line: lineNum,
        character: segStart + (sm[0].length - sm[1].length),
        isComposable: false, depth,
      });
      if (ch === ';') return true;
      if (ch === '{') return false;
      segStart = i + 1;
    }
  }
  return false;
}

// Count `{` and `}` in text[start..end), skipping string literals and `//` comments.
function countJavaBraces(text: string, start: number, end: number, depth: number): number {
  let inStr: string | false = false;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '"' || c === '\'') { inStr = c; continue; }
    if (c === '/' && i + 1 < end && text[i + 1] === '/') break;
    if      (c === '{') depth++;
    else if (c === '}') { if (depth > 0) depth--; } // clamp — unmatched } must not produce negative depth
  }
  return depth;
}

const JAVA_DECL_START: Record<string, boolean> = Object.fromEntries(
  '@abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, true])
);

const RE_JAVA_TYPE_NAME = /\b([A-Z]\w+)\b/g;

// Strip generic params: "ArrayList<String>" → "ArrayList", "Map<K, V>" → "Map"
function stripGenerics(s: string): string {
  let result = '', depth = 0;
  for (const c of s) {
    if (c === '<') { depth++; continue; }
    if (c === '>') { depth--; continue; }
    if (depth === 0) result += c;
  }
  return result;
}

function extractJavaSupertypes(line: string): string[] {
  const types: string[] = [];
  const extendsMatch = /\bextends\s+(.+?)(?:\bimplements\b|\{|$)/.exec(line);
  if (extendsMatch) {
    const clean = stripGenerics(extendsMatch[1]);
    RE_JAVA_TYPE_NAME.lastIndex = 0;
    let m;
    while ((m = RE_JAVA_TYPE_NAME.exec(clean))) types.push(m[1]);
  }
  const implMatch = /\bimplements\s+(.+?)(?:\{|$)/.exec(line);
  if (implMatch) {
    const clean = stripGenerics(implMatch[1]);
    RE_JAVA_TYPE_NAME.lastIndex = 0;
    let m;
    while ((m = RE_JAVA_TYPE_NAME.exec(clean))) types.push(m[1]);
  }
  return types;
}

function toJavaKind(keyword: string): SymbolKind {
  switch (keyword) {
    case 'enum':        return 'enum';
    case 'interface':   return 'interface';
    case '@interface':  return 'annotation';
    default:            return 'class'; // class, record
  }
}
