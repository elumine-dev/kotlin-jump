// No vscode import — this module runs in Node.js worker threads too

export type SymbolKind =
  | 'class' | 'interface' | 'object' | 'enum'
  | 'dataClass' | 'sealedClass' | 'annotation'
  | 'fun' | 'composable'
  | 'val' | 'var'
  | 'typealias';

export interface RawSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  character: number;
  isComposable: boolean;
  depth: number;          // braceDepth at declaration — used for outline hierarchy
  aliasTarget?: string;   // raw rhs of typealias, e.g. "List<UserProfile>"
  supertypes?: string[];  // simple names of superclasses/interfaces, e.g. ["Bar", "Baz"]
  isSuspend?:       boolean;
  isAbstract?:      boolean;
  isConst?:         boolean;
  isExtension?:     boolean; // fun with receiver type, e.g. fun String.foo()
  isInline?:        boolean;
  isInfix?:         boolean;
  isLateinit?:      boolean;
  isHiltViewModel?: boolean; // class annotated with @HiltViewModel
  isOperator?:      boolean; // operator fun (e.g. operator fun plus())
  isOverride?:      boolean; // override fun / override val
  isPreview?:       boolean; // function annotated with @Preview
  isPrivate?:       boolean; // private val/var/fun/class — not visible outside declaring file
  isDeprecated?:    boolean; // annotated with @Deprecated
  isTest?:          boolean; // fun annotated with @Test / @ParameterizedTest etc.
  isTestClass?:     boolean; // class annotated with @RunWith
  isIgnored?:       boolean; // fun annotated with @Ignore / @Disabled
  isLifecycle?:     boolean; // fun annotated with @Before / @After etc. (excluded from test discovery)
}

export interface ParsedFile {
  uriString: string;   // vscode.Uri.toString() — no vscode dep needed
  packageName: string;
  imports: string[];
  symbols: RawSymbol[];
}

// ── All regexes compiled ONCE at module load ─────────────────────────────────
const RE_PACKAGE    = /^\s*package\s+([\w.]+)/;
const RE_IMPORT     = /^\s*import\s+([\w.*]+)/;
const RE_COMPOSABLE  = /@Composable\b/;
const RE_PREVIEW     = /@Preview\b/;
const RE_DEPRECATED  = /@Deprecated\b/;
const RE_TEST        = /@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;
const RE_RUN_WITH    = /@RunWith\b/;
const RE_IGNORE      = /@(?:Ignore|Disabled)\b/;
const RE_LIFECYCLE   = /@(?:Before|After|BeforeEach|AfterEach|BeforeAll|AfterAll|BeforeClass|AfterClass)\b/;
const RE_CLASS      = /^\s*(?:(?:public|private|internal|protected|open|abstract|inner|sealed|data|annotation|enum|actual|expect|companion)\s+)*?(data\s+class|sealed\s+class|sealed\s+interface|fun\s+interface|enum\s+class|annotation\s+class|class|interface|object)\s+([\p{L}\p{N}_]+)/u;
// After optional generics, allow an optional `ReceiverType.` prefix so that
// `fun Modifier.customBackground()` captures "customBackground", not "Modifier".
// Handles: simple (Modifier.), nullable (Modifier?.), generic (List<T>.), qualified (Modifier.Companion.)
const RE_FUN        = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|override|actual|expect|suspend|inline|noinline|crossinline|infix|operator|tailrec|external)\s+)*fun\s+(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>\s+)?(?:(?:\w+(?:<(?:[^<>]|<[^<>]*>)*>)?[?]?\.)+)?([\p{L}\p{N}_]+|`[^`]+`)\s*[(<]/u;
const RE_PROP       = /^\s*(?:(?:public|private|protected|internal|override|open|abstract|actual|expect|lateinit|const)\s+)*(val|var)\s+([\p{L}\p{N}_]+)\s*(?:[=:(<]|\bby\b)/u;
const RE_TYPEALIAS  = /^\s*(?:(?:public|private|internal|actual)\s+)?typealias\s+([\p{L}\p{N}_]+)(?:<[^>]*>)?\s*=\s*(.+)/u;
const RE_ENUM_ENTRY = /^\s*([A-Z][A-Z0-9_]*)(?:\s*[,(;({]|$)/;

// ─────────────────────────────────────────────────────────────────────────────

export function parse(uriString: string, text: string): ParsedFile {
  const symbols: RawSymbol[] = [];
  let packageName = '';
  const imports: string[] = [];

  let inBlockComment = false;
  let inRawString    = false; // true when inside a """ ... """ multi-line raw string
  let braceDepth     = 0;
  let parenDepth     = 0; // tracks ( ) so constructor params are not mistaken for class members
  let enumBraceDepth = -1; // -1 = not inside an enum body

  // 3-line sliding window for @Composable detection before fun
  const annotationWindow: string[] = [];

  const len = text.length;
  let pos     = 0;
  let lineNum = 0;

  while (pos < len) {
    // ── Find line boundaries without allocating an array ───────────────────
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;

    // ── Fast skip: truly empty line ────────────────────────────────────────
    if (nl === pos) { pos = nl + 1; lineNum++; continue; }

    // ── Find first non-whitespace offset ──────────────────────────────────
    let fns = pos;
    while (fns < nl && (text[fns] === ' ' || text[fns] === '\t')) fns++;

    if (fns >= nl) { pos = nl + 1; lineNum++; continue; } // blank line

    const fc  = text[fns];
    const fc1 = fns + 1 < nl ? text[fns + 1] : '';

    // ── Fast skip: line comment ────────────────────────────────────────────
    if (fc === '/' && fc1 === '/') { pos = nl + 1; lineNum++; continue; }

    // ── Block comment open ─────────────────────────────────────────────────
    if (fc === '/' && fc1 === '*') {
      const closePos = text.indexOf('*/', fns + 2);
      if (closePos === -1 || closePos >= nl) inBlockComment = true;
      // count braces/parens even in single-line block comment lines
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Inside block comment ───────────────────────────────────────────────
    if (inBlockComment) {
      const close = text.indexOf('*/', pos);
      if (close !== -1 && close < nl) inBlockComment = false;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Inside multi-line raw string ───────────────────────────────────────
    if (inRawString) {
      const lineStr = text.slice(pos, nl);
      if (countTripleQuoteToggles(lineStr) % 2 !== 0) inRawString = false;
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      pos = nl + 1; lineNum++; continue;
    }

    // ── O(1) first-char pre-filter — skip lines that can't be declarations ─
    // Exception: when we are exactly at enum-entry depth, uppercase lines must
    // pass through so RE_ENUM_ENTRY can match CONNECTED, OFFLINE, RED, etc.
    const atEnumEntryDepth = enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1;
    if (!DECL_START[fc] && !atEnumEntryDepth) {
      const prevParenDepth = parenDepth;
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      // Only clear annotation window when not inside a multi-line annotation's paren args
      if (fc !== '@' && prevParenDepth === 0) annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Lazy slice — only allocate when we need regex ─────────────────────
    const raw = text.slice(pos, nl);
    const lineTripleQuotes = countTripleQuoteToggles(raw);

    // ── Package ────────────────────────────────────────────────────────────
    if (!packageName && fc === 'p') {
      const m = RE_PACKAGE.exec(raw);
      if (m) { packageName = m[1]; if (lineTripleQuotes % 2 !== 0) inRawString = true; pos = nl + 1; lineNum++; continue; }
    }

    // ── Imports ────────────────────────────────────────────────────────────
    if (fc === 'i' && raw.charCodeAt(fns - pos + 1) === 109 /* 'm' */) {
      const m = RE_IMPORT.exec(raw);
      if (m) { imports.push(m[1]); if (lineTripleQuotes % 2 !== 0) inRawString = true; pos = nl + 1; lineNum++; continue; }
    }

    // ── Class-like declarations ────────────────────────────────────────────
    const cm = RE_CLASS.exec(raw);
    if (cm) {
      const keyword = cm[1].replace(/\s+/g, ' ');
      const name    = cm[2];
      const kind    = toClassKind(keyword);
      const nameEnd = raw.indexOf(name, cm.index) + name.length;

      let supertypes = extractSupertypes(raw, nameEnd);
      // Only look ahead for `) : Types` if the line has an unclosed paren (multi-line constructor)
      if (supertypes.length === 0 && hasUnclosedParen(raw, nameEnd)) {
        supertypes = lookAheadSupertypes(text, nl + 1);
      }

      // Slice up to the class NAME (not cm.index which is always 0) so modifiers
      // before the keyword are captured: "private data class Foo" → "private data class "
      const preClass        = raw.slice(0, raw.indexOf(name, cm.index));
      const isAbstract      = /\babstract\b/.test(preClass) || undefined;
      const isPrivate       = /\bprivate\b/.test(preClass)  || undefined;
      const isHiltViewModel = annotationWindow.some(l => /@HiltViewModel\b/.test(l)) || undefined;
      const isDeprecated    = annotationWindow.some(l => RE_DEPRECATED.test(l))      || undefined;
      const isTestClass     = annotationWindow.some(l => RE_RUN_WITH.test(l))        || undefined;

      symbols.push({ name, kind, line: lineNum, character: raw.indexOf(name, cm.index), isComposable: false, depth: braceDepth, supertypes: supertypes.length > 0 ? supertypes : undefined, isAbstract, isPrivate, isHiltViewModel, isDeprecated, isTestClass });

      if (kind === 'enum') enumBraceDepth = braceDepth;

      // ── Inline body members for non-enum class-like declarations ───────────
      // E.g.: `interface Repo { fun get(): T }`, `object Utils { val x = 1 }`,
      //        `sealed class S { class A : S(); class B : S() }`,
      //        `companion object Companion { const val TAG = "Foo" }`
      // When the opening `{` is on the same declaration line, countDepth (below)
      // will close the brace and members inside are never seen by the per-line
      // regexes on subsequent iterations.
      if (kind !== 'enum') {
        const bodyOpen = raw.indexOf('{', nameEnd);
        if (bodyOpen !== -1) {
          emitInlineBodySymbols(raw, bodyOpen, lineNum, braceDepth + 1, symbols);
        }
      }

      // ── Inline enum entries (e.g. `enum class Color { RED, GREEN }`) ──────
      // When entries are on the same line as the declaration, the enum-entry
      // section below never fires because enumBraceDepth is reset after
      // countDepth processes the closing `}` on this line.
      if (kind === 'enum') {
        const enumBodyOpen = raw.indexOf('{', nameEnd);
        if (enumBodyOpen !== -1) {
          const enumBodyClose = raw.indexOf('}', enumBodyOpen + 1);
          const inlineEnd = enumBodyClose !== -1 ? enumBodyClose : raw.length;
          const inline    = raw.slice(enumBodyOpen + 1, inlineEnd);
          let parenD = 0, segStart = 0;
          for (let i = 0; i <= inline.length; i++) {
            const ch = i < inline.length ? inline[i] : '\0';
            if      (ch === '(' || ch === '[') { parenD++; continue; }
            else if (ch === ')' || ch === ']') { parenD--; continue; }
            else if (parenD > 0)               { continue; }
            if (ch === ',' || ch === ';' || i === inline.length) {
              const seg = inline.slice(segStart, i);
              const sm  = /^\s*([A-Z][A-Z0-9_]*)/.exec(seg);
              if (sm) symbols.push({
                name: sm[1], kind: 'enum', line: lineNum,
                character: enumBodyOpen + 1 + segStart + (sm[0].length - sm[1].length),
                isComposable: false, depth: braceDepth + 1,
              });
              if (ch === ';') break;
              segStart = i + 1;
            }
          }
        }
      }

      // ── Inline primary-constructor val/var (single-line: class Foo(val x: Int)) ──
      // When class + constructor are on one line, RE_PROP never runs on those params.
      // Find the balanced () of the primary constructor and extract val/var inside it.
      const ctorOpen = raw.indexOf('(', nameEnd - name.length);
      if (ctorOpen !== -1) {
        let pd = 0, ctorClose = -1;
        for (let ci = ctorOpen; ci < raw.length; ci++) {
          if (raw[ci] === '(') pd++;
          else if (raw[ci] === ')') { pd--; if (pd === 0) { ctorClose = ci; break; } }
        }
        if (ctorClose !== -1) {
          const ctorSlice = raw.slice(ctorOpen + 1, ctorClose);
          const INLINE_PROP_RE = /\b(val|var)\s+(\w+)/g;
          let ip: RegExpExecArray | null;
          while ((ip = INLINE_PROP_RE.exec(ctorSlice)) !== null) {
            symbols.push({
              name: ip[2],
              kind: ip[1] === 'val' ? 'val' : 'var',
              line: lineNum,
              character: ctorOpen + 1 + ip.index + (ip[0].length - ip[2].length),
              isComposable: false,
              depth: braceDepth + 1,
            });
          }
        }
      }

      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Enum entries ───────────────────────────────────────────────────────
    if (enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1) {
      const em = RE_ENUM_ENTRY.exec(raw);
      if (em) {
        // Split the line at depth-0 commas so that `REGULAR, EXTRA` on one line
        // indexes both entries. Paren depth is tracked so commas inside constructor
        // args like `ACTIVE(1), INACTIVE(0)` don't create spurious splits.
        const RE_ENTRY_NAME = /^\s*([A-Z][A-Z0-9_]*)/;
        let parenD = 0;
        let segStart = 0;
        for (let i = 0; i <= raw.length; i++) {
          const ch = i < raw.length ? raw[i] : '\0';
          if      (ch === '(' || ch === '[') { parenD++; continue; }
          else if (ch === ')' || ch === ']') { parenD--; continue; }
          else if (parenD > 0)               { continue; }
          if (ch === ',' || ch === ';' || ch === '{' || i === raw.length) {
            const seg = raw.slice(segStart, i);
            const sm = RE_ENTRY_NAME.exec(seg);
            if (sm) symbols.push({ name: sm[1], kind: 'enum', line: lineNum, character: segStart + (sm[0].length - sm[1].length), isComposable: false, depth: braceDepth });
            if (ch === ';' || ch === '{') break;
            segStart = i + 1;
          }
        }
        [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
        if (braceDepth <= enumBraceDepth) enumBraceDepth = -1;
        if (lineTripleQuotes % 2 !== 0) inRawString = true;
        pos = nl + 1; lineNum++; continue;
      }
    }

    // ── Functions ──────────────────────────────────────────────────────────
    const fm = RE_FUN.exec(raw);
    if (fm) {
      // Strip backticks from backtick-quoted names (e.g. `fun \`my fun\`()`)
      const rawName = fm[1];
      const funName = rawName.startsWith('`') ? rawName.slice(1, -1) : rawName;
      // Check annotation window AND the current line for @Composable/@Preview/@Deprecated
      const isComposable  = annotationWindow.some(l => RE_COMPOSABLE.test(l)) || RE_COMPOSABLE.test(raw);
      const isPreview     = annotationWindow.some(l => RE_PREVIEW.test(l))    || RE_PREVIEW.test(raw)    || undefined;
      const isDeprecated  = annotationWindow.some(l => RE_DEPRECATED.test(l)) || RE_DEPRECATED.test(raw) || undefined;
      const isTest        = annotationWindow.some(l => RE_TEST.test(l))       || RE_TEST.test(raw)       || undefined;
      const isIgnored     = annotationWindow.some(l => RE_IGNORE.test(l))     || RE_IGNORE.test(raw)     || undefined;
      const isLifecycle   = annotationWindow.some(l => RE_LIFECYCLE.test(l))  || RE_LIFECYCLE.test(raw)  || undefined;
      const preFun        = raw.slice(0, raw.lastIndexOf('fun'));
      const isSuspend     = /\bsuspend\b/.test(preFun)  || undefined;
      const isAbstract    = /\babstract\b/.test(preFun)  || undefined;
      const isInline      = /\binline\b/.test(preFun)    || undefined;
      const isInfix       = /\binfix\b/.test(preFun)     || undefined;
      const isExtension   = /fun\s+(?:<(?:[^<>]|<[^<>]*>)*>\s+)?(?:\w+(?:<(?:[^<>]|<[^<>]*>)*>)?[?]?\.)/.test(raw) || undefined;
      const isOperator    = /\boperator\b/.test(preFun)  || undefined;
      const isOverride    = /\boverride\b/.test(preFun)  || undefined;
      const isPrivateFun  = /\bprivate\b/.test(preFun)   || undefined;
      symbols.push({
        name: funName,
        kind: isComposable ? 'composable' : 'fun',
        line: lineNum,
        character: raw.indexOf(rawName, fm.index),
        isComposable,
        depth: braceDepth,
        isSuspend,
        isAbstract,
        isInline,
        isInfix,
        isExtension,
        isOperator,
        isOverride,
        isPreview,
        isPrivate: isPrivateFun,
        isDeprecated,
        isTest,
        isIgnored,
        isLifecycle,
      });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Properties ────────────────────────────────────────────────────────────
    // parenDepth===1 covers primary-constructor val/var (e.g. data class Foo(val x: Int)).
    // Kotlin function params cannot be val/var, so parenDepth===1 safely identifies
    // primary-constructor properties only. Use braceDepth+1 as effective depth so
    // they are treated as class members, not top-level symbols.
    const pm = RE_PROP.exec(raw);
    const isPrimaryCtorParam = parenDepth === 1;
    if (pm && (parenDepth === 0 || isPrimaryCtorParam)) {
      const propDepth    = isPrimaryCtorParam ? braceDepth + 1 : braceDepth;
      const propPre      = raw.slice(0, raw.indexOf(pm[1]));
      const isConst      = /\bconst\b/.test(propPre)    || undefined;
      const isAbstract   = /\babstract\b/.test(propPre) || undefined;
      const isLateinit   = /\blateinit\b/.test(propPre) || undefined;
      const isOverride   = /\boverride\b/.test(propPre) || undefined;
      const isPrivate    = /\bprivate\b/.test(propPre)  || undefined;
      const isDeprecated = annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined;
      symbols.push({
        name: pm[2],
        kind: pm[1] === 'val' ? 'val' : 'var',
        line: lineNum,
        character: raw.indexOf(pm[2], pm.index),
        isComposable: false,
        depth: propDepth,
        isConst,
        isAbstract,
        isLateinit,
        isOverride,
        isPrivate,
        isDeprecated,
      });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Typealias ──────────────────────────────────────────────────────────
    const ta = RE_TYPEALIAS.exec(raw);
    if (ta) {
      const isDeprecated = annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined;
      symbols.push({ name: ta[1], kind: 'typealias', line: lineNum, character: raw.indexOf(ta[1], ta.index), isComposable: false, depth: braceDepth, aliasTarget: ta[2]?.trim(), isDeprecated });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Annotation window update ────────────────────────────────────────────
    if (fc === '@') {
      if (annotationWindow.length >= 3) annotationWindow.shift();
      annotationWindow.push(raw.trimStart());
    } else if (parenDepth === 0) {
      // Only clear when not inside a multi-line annotation's paren args
      annotationWindow.length = 0;
    }

    [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
    if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
    if (lineTripleQuotes % 2 !== 0) inRawString = true;
    pos = nl + 1;
    lineNum++;
  }

  return { uriString, packageName, imports, symbols };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Counts the number of `"""` occurrences in a string (non-overlapping).
// An odd count means this line toggles in/out of a raw string.
function countTripleQuoteToggles(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}

// Count { } and ( ) in text[start..end) — operates on original text, no slice
function countDepth(
  text: string, start: number, end: number, braces: number, parens: number,
): [number, number] {
  let inStr: string | false = false; // tracks ' or " when inside a string
  for (let i = start; i < end; i++) {
    const c = text[i];
    // Skip string contents
    if (inStr) {
      if (c === '\\') { i++; continue; } // skip escaped char
      if (c === inStr) inStr = false;
      continue;
    }
    // Handle triple-quoted strings (must check BEFORE single-quote check)
    if (c === '"' && i + 2 < end && text[i + 1] === '"' && text[i + 2] === '"') {
      i += 3;
      while (i + 2 < end) {
        if (text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"') { i += 2; break; }
        i++;
      }
      continue;
    }
    if (c === '"' || c === '\'') { inStr = c; continue; }
    // Stop at trailing line comment
    if (c === '/' && i + 1 < end && text[i + 1] === '/') break;
    if      (c === '{') braces++;
    else if (c === '}') { if (braces > 0) braces--; } // clamp — unmatched } in malformed input must not produce negative depth
    else if (c === '(') parens++;
    else if (c === ')') { if (parens > 0) parens--; } // same for unmatched )
  }
  return [braces, parens];
}

// O(1) lookup table — true means the character can start a Kotlin declaration
// Covers: @ a c d e f i l o p s t v (and uppercase for enum entries handled separately)
const DECL_START: Record<string, boolean> = Object.fromEntries(
  '@acdefilopstv'.split('').map(c => [c, true])
);

// True if line has more '(' than ')' after the given position (multi-line constructor)
function hasUnclosedParen(line: string, from: number): boolean {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    if (line.charAt(i) === '(') depth++;
    else if (line.charAt(i) === ')') depth--;
  }
  return depth > 0;
}

// Scan the line after the class name for `: SuperType, Interface`
// Skips balanced <> and () blocks so constructor params and generics are ignored
function extractSupertypes(line: string, nameEnd: number): string[] {
  let depth = 0;
  for (let i = nameEnd; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '<' || ch === '(') { depth++; }
    else if (ch === '>' || ch === ')') { depth--; }
    else if (depth === 0 && ch === '{') return [];
    else if (depth === 0 && ch === ':') {
      return parseTypeNames(line.substring(i + 1));
    }
  }
  return [];
}

// For multi-line constructors: scan forward for `) : Types` on subsequent lines
function lookAheadSupertypes(text: string, start: number): string[] {
  let p = start;
  for (let i = 0; i < 20 && p < text.length; i++) {
    let nl = text.indexOf('\n', p);
    if (nl === -1) nl = text.length;
    const line = text.slice(p, nl).trimStart();
    const m = /^\)\s*:\s*(.+)/.exec(line);
    if (m) return parseTypeNames(m[1]);
    if (line.startsWith('{')) return [];
    p = nl + 1;
  }
  return [];
}

const RE_TYPE_NAME = /\b([A-Z]\w*)\b/g;

function parseTypeNames(s: string): string[] {
  const clean = s.split(/\bwhere\b/)[0].split('{')[0];
  const types: string[] = [];
  RE_TYPE_NAME.lastIndex = 0;
  let m;
  while ((m = RE_TYPE_NAME.exec(clean))) types.push(m[1]);
  return types;
}

// Parses member declarations from the inline body of a class/interface/object.
// Called when the opening `{` appears on the same line as the declaration so
// the per-line regex loop never fires for those members.
//
// Splits the body by `;` at paren/brace depth 0 (handles `fun f(a: Int, b: Int)`
// and `fun f() { }` without splitting inside parameter lists or method bodies).
// Each segment is tried against RE_CLASS → RE_FUN → RE_PROP in order.
// Does NOT recurse into nested inline bodies (keeps complexity bounded).
function emitInlineBodySymbols(
  raw: string,
  bodyOpen: number,   // index of `{` in raw
  lineNum: number,
  memberDepth: number,
  symbols: RawSymbol[],
): void {
  // Find the matching `}` on this line, or use end-of-string
  let d = 0, bodyEnd = raw.length;
  for (let i = bodyOpen; i < raw.length; i++) {
    if      (raw[i] === '{') d++;
    else if (raw[i] === '}') { d--; if (d === 0) { bodyEnd = i; break; } }
  }

  const body = raw.slice(bodyOpen + 1, bodyEnd);
  if (!body.trim()) return;

  // Split on `;` at combined paren + brace depth 0
  let pD = 0, bD = 0, segStart = 0;

  const trySegment = (seg: string, offset: number): void => {
    if (!seg.trim()) return;

    // ── class-like ─────────────────────────────────────────────────────────
    const cm = RE_CLASS.exec(seg);
    if (cm) {
      const kw = cm[1].replace(/\s+/g, ' ');
      const n  = cm[2];
      const ni = seg.indexOf(n, cm.index);
      const pre = seg.slice(0, ni);
      const st  = extractSupertypes(seg, ni + n.length);
      symbols.push({
        name: n, kind: toClassKind(kw), line: lineNum,
        character: offset + ni,
        isComposable: false, depth: memberDepth,
        supertypes: st.length > 0 ? st : undefined,
        isAbstract: /\babstract\b/.test(pre) || undefined,
        isPrivate:  /\bprivate\b/.test(pre)  || undefined,
      });
      // Inline ctor val/var for nested class (e.g. `data class Ok(val x: Int) : R()`)
      const ctorO = seg.indexOf('(', ni + n.length);
      if (ctorO !== -1) {
        let pd = 0, ctorC = -1;
        for (let i = ctorO; i < seg.length; i++) {
          if      (seg[i] === '(') pd++;
          else if (seg[i] === ')') { pd--; if (pd === 0) { ctorC = i; break; } }
        }
        if (ctorC !== -1) {
          const slice = seg.slice(ctorO + 1, ctorC);
          const IPR = /\b(val|var)\s+(\w+)/g;
          let ip: RegExpExecArray | null;
          while ((ip = IPR.exec(slice)) !== null) {
            symbols.push({
              name: ip[2], kind: ip[1] === 'val' ? 'val' : 'var',
              line: lineNum,
              character: offset + ctorO + 1 + ip.index + (ip[0].length - ip[2].length),
              isComposable: false, depth: memberDepth + 1,
            });
          }
        }
      }
      return;
    }

    // ── fun ────────────────────────────────────────────────────────────────
    const fm = RE_FUN.exec(seg);
    if (fm) {
      const preFun = seg.slice(0, seg.lastIndexOf('fun'));
      symbols.push({
        name: fm[1], kind: RE_COMPOSABLE.test(preFun) ? 'composable' : 'fun', line: lineNum,
        character: offset + seg.indexOf(fm[1], fm.index),
        isComposable: RE_COMPOSABLE.test(preFun),
        depth: memberDepth,
        isSuspend:   /\bsuspend\b/.test(preFun)   || undefined,
        isOverride:  /\boverride\b/.test(preFun)   || undefined,
        isAbstract:  /\babstract\b/.test(preFun)   || undefined,
        isPrivate:   /\bprivate\b/.test(preFun)    || undefined,
        isInline:    /\binline\b/.test(preFun)     || undefined,
        isOperator:  /\boperator\b/.test(preFun)   || undefined,
        isTest:      RE_TEST.test(preFun)          || undefined,
        isIgnored:   RE_IGNORE.test(preFun)        || undefined,
        isLifecycle: RE_LIFECYCLE.test(preFun)     || undefined,
      });
      return;
    }

    // ── val / var ──────────────────────────────────────────────────────────
    const pm = RE_PROP.exec(seg);
    if (pm) {
      const propPre = seg.slice(0, seg.indexOf(pm[1]));
      symbols.push({
        name: pm[2], kind: pm[1] === 'val' ? 'val' : 'var',
        line: lineNum,
        character: offset + seg.indexOf(pm[2], pm.index),
        isComposable: false, depth: memberDepth,
        isConst:    /\bconst\b/.test(propPre)    || undefined,
        isOverride: /\boverride\b/.test(propPre) || undefined,
        isPrivate:  /\bprivate\b/.test(propPre)  || undefined,
        isLateinit: /\blateinit\b/.test(propPre) || undefined,
        isAbstract: /\babstract\b/.test(propPre) || undefined,
      });
    }
  };

  for (let i = 0; i <= body.length; i++) {
    const c = i < body.length ? body[i] : '\0';
    if      (c === '(' || c === '[') pD++;
    else if (c === ')' || c === ']') pD--;
    else if (c === '{')               bD++;
    else if (c === '}')               bD--;
    if ((c === ';' || i === body.length) && pD === 0 && bD === 0) {
      trySegment(body.slice(segStart, i), bodyOpen + 1 + segStart);
      segStart = i + 1;
    }
  }
}

function toClassKind(keyword: string): SymbolKind {
  switch (keyword) {
    case 'data class':       return 'dataClass';
    case 'sealed class':
    case 'sealed interface': return 'sealedClass';
    case 'fun interface':    return 'interface';
    case 'enum class':       return 'enum';
    case 'annotation class': return 'annotation';
    case 'interface':        return 'interface';
    case 'object':           return 'object';
    default:                 return 'class';
  }
}
