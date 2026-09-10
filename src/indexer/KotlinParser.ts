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
  /**
   * Names in `supertypes` that were only the QUALIFIER of a dotted supertype:
   * `: RecyclerView.Adapter` yields both, but only `Adapter` is a parent.
   * They stay in `supertypes` because the dead code scan reads that list to
   * spot a framework ancestor; the hierarchy must skip them.
   */
  superQualifiers?: string[];
  constValue?:      string;  // raw literal value for const val, e.g. `5000` or `"v2"`
  isSuspend?:       boolean;
  isAbstract?:      boolean;
  isConst?:         boolean;
  isExpect?:        boolean; // Kotlin KMP `expect` declaration — signature-only, no body
  isActual?:        boolean; // Kotlin KMP `actual` declaration — platform implementation
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
  isPrimaryCtorParam?: boolean; // val/var declared in a primary constructor, not the class body
  isTest?:          boolean; // fun annotated with @Test / @ParameterizedTest etc.
  isTestClass?:     boolean; // class annotated with @RunWith
  isIgnored?:       boolean; // fun annotated with @Ignore / @Disabled
  isLifecycle?:     boolean; // fun annotated with @Before / @After etc. (excluded from test discovery)
  isCompanion?:     boolean; // unnamed `companion object`, emitted as "Companion" so the Outline nests its members
  isLocal?:         boolean; // val/var declared inside a function body or a property initializer, not a member
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
// Same-line annotations before a declaration: `@AndroidEntryPoint class`,
// `@Entity(tableName = "x") data class`, `@Inject lateinit var`,
// `@field:SerializedName("a") val`. One level of nested parens covers
// `@Foo(bar = baz())`; the character classes keep matching linear.
const ANNOT = String.raw`(?:@(?:\w+:)?[\w.]+(?:\((?:[^()]|\([^()]*\))*\))?\s+)*`;
// Kotlin allows an annotation on the RECEIVER, after the keyword:
// `fun @receiver:ColorInt Int.darken(n: Int)`. Without this the whole
// declaration was missed, so the function existed for no feature at all.
const RECV_ANNOT = ANNOT;
// `fun [receiver annotation] [type params] Receiver.` — the receiver marks an
// extension. Reading it without the annotation left `fun @receiver:ColorInt
// Int.darken()` looking like a plain function.
const RE_FUN_RECEIVER = new RegExp(String.raw`fun\s+${RECV_ANNOT}(?:<(?:[^<>]|<[^<>]*>)*>\s+)?(?:\w+(?:<(?:[^<>]|<[^<>]*>)*>)?[?]?\.)`);
const MODS_CLASS = 'public|private|internal|protected|open|final|abstract|inner|sealed|data|value|inline|annotation|enum|actual|expect|companion|external';
// The name is the last group and the match ends on it, so its column is
// `m[0].length - name.length`: an indexOf() would find the name inside a
// preceding annotation string (`@SerialName("user") class user`).
const RE_CLASS      = new RegExp(String.raw`^\s*${ANNOT}(?:(?:${MODS_CLASS})\s+)*?(data\s+class|sealed\s+class|sealed\s+interface|fun\s+interface|enum\s+class|annotation\s+class|value\s+class|class|interface|object)\s+([\p{L}\p{N}_]+)`, 'u');
// Unnamed `companion object` (RE_CLASS needs a name after the keyword).
// Group 1 = leading modifiers, so the column of `companion` is its length.
const RE_COMPANION  = /^(\s*(?:(?:public|private|internal|protected)\s+)*)companion\s+object\b(?!\s*[\p{L}\p{N}_])/u;
// Matches anonymous objects: `object : Interface` (no name between `object` and `:`)
const RE_ANON_OBJECT = /\bobject\s*:/;
// After optional generics, allow an optional `ReceiverType.` prefix so that
// `fun Modifier.customBackground()` captures "customBackground", not "Modifier".
// Handles: simple (Modifier.), nullable (Modifier?.), generic (List<T>.), qualified (Modifier.Companion.)
const RE_FUN        = new RegExp(String.raw`^\s*${ANNOT}(?:(?:public|private|protected|internal|override|final|abstract|open|actual|expect|suspend|inline|noinline|crossinline|infix|operator|tailrec|external)\s+)*fun\s+${RECV_ANNOT}(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>\s+)?(?:(?:\w+(?:<(?:[^<>]|<[^<>]*>)*>)?[?]?\.)+)?([\p{L}\p{N}_]+|\x60[^\x60]+\x60)(?=\s*[(<])`, 'u'); // \x60 = backtick (String.raw keeps the backslash of \`)
// Group 1 = val/var, group 2 = extension receiver (`List<Int>.`), group 3 = name.
// The trailer is a lookahead so the match ends on the name (see RE_CLASS).
const RE_PROP       = new RegExp(String.raw`^\s*${ANNOT}(?:(?:public|private|protected|internal|override|open|final|abstract|actual|expect|lateinit|const|inline|external)\s+)*(val|var)\s+${RECV_ANNOT}(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>\s+)?((?:\w+(?:<(?:[^<>]|<[^<>]*>)*>)?[?]?\.)+)?([\p{L}\p{N}_]+)(?=\s*(?:[=:(<]|\bby\b))`, 'u');
const RE_TYPEALIAS  = /^\s*(?:(?:public|private|internal|actual)\s+)?typealias\s+([\p{L}\p{N}_]+)(?:<[^>]*>)?\s*=\s*(.+)/u;
// Enum entries may be SCREAMING_CASE or UpperCamelCase (both are legal and
// idiomatic Kotlin). The name must exhaust the identifier: requiring a
// delimiter (or EOL/comment) right after prevents `Home` from being indexed
// as a phantom entry `H`.
// Group 1 = whitespace + same-line annotations (`@SerializedName("a") ACTIVE`),
// so the entry column is its length: the name can also appear inside the
// annotation string. Group 2 = the entry name.
const RE_ENUM_ENTRY = new RegExp(String.raw`^(\s*${ANNOT})([A-Z]\w*)\s*(?:[,(;({]|//|$)`);
// Per-segment variant once a line is split at depth-0 commas.
const RE_ENTRY_NAME = new RegExp(String.raw`^(\s*${ANNOT})([A-Z]\w*)\s*(?:[({]|//|$)`);

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
  // A class header left its primary-constructor paren open on this brace
  // depth. parenDepth === 1 alone also matched a lambda passed as a named
  // argument (`foo(onClick = { val x = 1 })`) and indexed its locals as
  // constructor properties.
  let ctorParamsActive = false;
  let ctorBraceDepth   = -1;

  // 3-line sliding window for @Composable detection before fun
  const annotationWindow: string[] = [];

  const len = text.length;
  let pos     = 0;
  let lineNum = 0;

  // Per-line depth bookkeeping shared by every branch below.
  const advance = (nl: number): void => {
    const r = countDepth(text, pos, nl, braceDepth, parenDepth);
    braceDepth = r[0]; parenDepth = r[1];
    if (r[2]) inBlockComment = true; // `/*` opened mid-line and not closed
    if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
    if (parenDepth === 0) ctorParamsActive = false;
  };

  // Monotone cursor over the next `object` keyword. Lets the DECL_START
  // pre-filter still notice `.setListener(object : X {` without slicing every
  // line: pos only moves forward, so the total cost stays one pass over text.
  let nextObjectAt = text.indexOf('object');

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
      // countDepth skips the comment itself but still counts code after `*/`
      // (and flags a comment left open on this line).
      advance(nl);
      pos = nl + 1; lineNum++; continue;
    }

    // ── Inside block comment ───────────────────────────────────────────────
    if (inBlockComment) {
      const close = text.indexOf('*/', pos);
      if (close !== -1 && close < nl) {
        inBlockComment = false;
        // `*/ }` : the brace after the close still counts.
        const r = countDepth(text, close + 2, nl, braceDepth, parenDepth);
        braceDepth = r[0]; parenDepth = r[1];
        if (r[2]) inBlockComment = true;
        if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      }
      pos = nl + 1; lineNum++; continue;
    }

    // ── Inside multi-line raw string ───────────────────────────────────────
    if (inRawString) {
      const lineStr = text.slice(pos, nl);
      if (countTripleQuoteToggles(lineStr) % 2 !== 0) inRawString = false;
      advance(nl);
      pos = nl + 1; lineNum++; continue;
    }

    // ── O(1) first-char pre-filter — skip lines that can't be declarations ─
    // Exception: when we are exactly at enum-entry depth, uppercase lines must
    // pass through so RE_ENUM_ENTRY can match CONNECTED, OFFLINE, RED, etc.
    const atEnumEntryDepth = enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1;
    if (nextObjectAt !== -1 && nextObjectAt < pos) nextObjectAt = text.indexOf('object', pos);
    const lineHasObject = nextObjectAt !== -1 && nextObjectAt < nl;
    if (!DECL_START[fc] && !atEnumEntryDepth) {
      // `return object : Sink {`, `.setListener(object : Adapter() {` — no
      // declaration keyword starts the line, but an implementation lives on it.
      if (lineHasObject) emitAnonObjectIfPresent(text.slice(pos, nl), lineNum, braceDepth, symbols);
      const prevParenDepth = parenDepth;
      advance(nl);
      // Only clear annotation window when not inside a multi-line annotation's paren args
      if (fc !== '@' && prevParenDepth === 0) annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Lazy slice — only allocate when we need regex ─────────────────────
    const raw = text.slice(pos, nl);
    const lineTripleQuotes = countTripleQuoteToggles(raw);

    // ── Anonymous object: `object : Interface` ─────────────────────────────
    // Done before the branch dispatch because every branch below ends in
    // `continue`: `fun provideX(): X = object : X {`, the Dagger form, used to
    // slip through the function branch and never be counted.
    if (lineHasObject) emitAnonObjectIfPresent(raw, lineNum, braceDepth, symbols);

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
      const keyword   = cm[1].replace(/\s+/g, ' ');
      const name      = cm[2];
      const kind      = toClassKind(keyword);
      const nameStart = cm[0].length - name.length;
      const nameEnd   = cm[0].length;

      const superQuals: string[] = [];
      let supertypes = extractSupertypes(raw, nameEnd, superQuals);
      // Only look ahead for `) : Types` if the line has an unclosed paren (multi-line constructor)
      if (supertypes.length === 0 && hasUnclosedParen(raw, nameEnd)) {
        superQuals.length = 0;
        supertypes = lookAheadSupertypes(text, nl + 1, superQuals, unclosedParenDepth(raw, nameEnd));
      } else if (headerContinues(raw, nameEnd)) {
        // `class LongActivity :\n    AppCompatActivity(),\n    Callback {` is how
        // ktlint wraps a long header: the list goes on below.
        superQuals.length = 0;
        supertypes = extractSupertypes(raw + ' ' + collectHeaderContinuation(text, nl + 1), nameEnd, superQuals);
      }

      // Slice up to the class NAME (not cm.index which is always 0) so modifiers
      // before the keyword are captured: "private data class Foo" → "private data class "
      const preClass        = raw.slice(0, nameStart);
      const isAbstract      = /\babstract\b/.test(preClass) || undefined;
      const isPrivate       = /\bprivate\b/.test(preClass)  || undefined;
      const isHiltViewModel = annotationWindow.some(l => /@HiltViewModel\b/.test(l)) || /@HiltViewModel\b/.test(preClass) || undefined;
      const isDeprecated    = annotationWindow.some(l => RE_DEPRECATED.test(l))      || RE_DEPRECATED.test(preClass)      || undefined;
      const isTestClass     = annotationWindow.some(l => RE_RUN_WITH.test(l))        || RE_RUN_WITH.test(preClass)        || undefined;
      const isExpect        = /\bexpect\b/.test(preClass)   || undefined;
      const isActual        = /\bactual\b/.test(preClass)   || undefined;

      symbols.push({ name, kind, line: lineNum, character: nameStart, isComposable: false, depth: braceDepth, supertypes: supertypes.length > 0 ? supertypes : undefined, superQualifiers: superQuals.length > 0 ? superQuals : undefined, isAbstract, isPrivate, isHiltViewModel, isDeprecated, isTestClass, isExpect, isActual });

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
              // Same full-identifier rule as RE_ENUM_ENTRY: the name must be
              // followed by ctor args, a body, a comment, or end of segment —
              // never a partial match (`Home` must not index as `H`).
              const sm  = RE_ENTRY_NAME.exec(seg);
              if (sm) symbols.push({
                name: sm[2], kind: 'enum', line: lineNum,
                character: enumBodyOpen + 1 + segStart + sm[1].length,
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
      const ctorOpen = raw.indexOf('(', nameStart);
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
              isPrimaryCtorParam: true,
            });
          }
        }
      }

      advance(nl);
      if (parenDepth > 0) { ctorParamsActive = true; ctorBraceDepth = braceDepth; }
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Unnamed companion object ────────────────────────────────────────────
    // Emitted as "Companion" (9 chars, like the keyword it sits on) so the
    // Outline nests its members instead of hanging them under the previous
    // member. SymbolIndex keeps it out of member FQNs (`Foo.TAG`, not
    // `Foo.Companion.TAG`) via isCompanion.
    const km = RE_COMPANION.exec(raw);
    if (km) {
      const character  = km[1].length;
      const objectEnd  = raw.indexOf('object', character) + 'object'.length;
      const compQuals: string[] = [];
      const supertypes = extractSupertypes(raw, objectEnd, compQuals);
      symbols.push({
        name: 'Companion', kind: 'object', line: lineNum, character,
        isComposable: false, depth: braceDepth,
        supertypes: supertypes.length > 0 ? supertypes : undefined,
        superQualifiers: compQuals.length > 0 ? compQuals : undefined,
        isPrivate: /\bprivate\b/.test(km[1]) || undefined,
        isCompanion: true,
      });
      const bodyOpen = raw.indexOf('{', objectEnd);
      if (bodyOpen !== -1) emitInlineBodySymbols(raw, bodyOpen, lineNum, braceDepth + 1, symbols);
      advance(nl);
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Enum entries ───────────────────────────────────────────────────────
    if (enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1) {
      // `;` alone on its line (ktlint style after a trailing comma) closes the
      // entry section: what follows are members, and an uppercase continuation
      // line (`= \n NAME`) must not become a phantom entry.
      if (raw.charCodeAt(fns - pos) === 59 /* ';' */) {
        enumBraceDepth = -1;
        advance(nl);
        if (lineTripleQuotes % 2 !== 0) inRawString = true;
        pos = nl + 1; lineNum++; continue;
      }
      const em = RE_ENUM_ENTRY.exec(raw);
      if (em) {
        // Split the line at depth-0 commas so that `REGULAR, EXTRA` on one line
        // indexes both entries. Paren depth is tracked so commas inside constructor
        // args like `ACTIVE(1), INACTIVE(0)` don't create spurious splits.
        let parenD = 0;
        let segStart = 0;
        let sawSemicolon = false;
        for (let i = 0; i <= raw.length; i++) {
          const ch = i < raw.length ? raw[i] : '\0';
          if      (ch === '(' || ch === '[') { parenD++; continue; }
          else if (ch === ')' || ch === ']') { parenD--; continue; }
          else if (parenD > 0)               { continue; }
          if (ch === ',' || ch === ';' || ch === '{' || i === raw.length) {
            const seg = raw.slice(segStart, i);
            const sm = RE_ENTRY_NAME.exec(seg);
            if (sm) symbols.push({ name: sm[2], kind: 'enum', line: lineNum, character: segStart + sm[1].length, isComposable: false, depth: braceDepth });
            if (ch === ';') { sawSemicolon = true; break; }
            if (ch === '{') break;
            segStart = i + 1;
          }
        }
        advance(nl);
        if (sawSemicolon) enumBraceDepth = -1;
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
      // A backtick name is stored without its backticks, so the column
      // skips the opening one: the Outline selection and the declaration token
      // must cover `returns user when found`, not start on the backtick.
      const nameStart     = fm[0].length - rawName.length + (rawName.charCodeAt(0) === 96 ? 1 : 0);
      const preFun        = raw.slice(0, nameStart);
      const isSuspend     = /\bsuspend\b/.test(preFun)  || undefined;
      const isAbstract    = /\babstract\b/.test(preFun)  || undefined;
      const isInline      = /\binline\b/.test(preFun)    || undefined;
      const isInfix       = /\binfix\b/.test(preFun)     || undefined;
      const isExtension   = RE_FUN_RECEIVER.test(raw) || undefined;
      const isOperator    = /\boperator\b/.test(preFun)  || undefined;
      const isOverride    = /\boverride\b/.test(preFun)  || undefined;
      const isPrivateFun  = /\bprivate\b/.test(preFun)   || undefined;
      const isExpect      = /\bexpect\b/.test(preFun)    || undefined;
      const isActual      = /\bactual\b/.test(preFun)    || undefined;
      symbols.push({
        name: funName,
        kind: isComposable ? 'composable' : 'fun',
        line: lineNum,
        character: nameStart,
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
        isExpect,
        isActual,
      });
      advance(nl);
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
    const isPrimaryCtorParam = parenDepth === 1 && ctorParamsActive && braceDepth === ctorBraceDepth;
    if (pm && (parenDepth === 0 || isPrimaryCtorParam)) {
      const propName     = pm[3];
      const nameStart    = pm[0].length - propName.length;
      const propDepth    = isPrimaryCtorParam ? braceDepth + 1 : braceDepth;
      const propPre      = raw.slice(0, nameStart);
      const isConst      = /\bconst\b/.test(propPre)    || undefined;
      const isAbstract   = /\babstract\b/.test(propPre) || (!isPrimaryCtorParam && isInInterfaceBodyAt(symbols, braceDepth)) || undefined;
      const isLateinit   = /\blateinit\b/.test(propPre) || undefined;
      const isOverride   = /\boverride\b/.test(propPre) || undefined;
      const isPrivate    = /\bprivate\b/.test(propPre)  || undefined;
      const isDeprecated = annotationWindow.some(l => RE_DEPRECATED.test(l)) || RE_DEPRECATED.test(propPre) || undefined;
      const isExpect     = /\bexpect\b/.test(propPre)   || undefined;
      const isActual     = /\bactual\b/.test(propPre)   || undefined;
      const constValue   = isConst ? extractConstValue(raw, pm[0].length) : undefined;
      symbols.push({
        name: propName,
        kind: pm[1] === 'val' ? 'val' : 'var',
        line: lineNum,
        character: nameStart,
        isComposable: false,
        depth: propDepth,
        isExtension: pm[2] ? true : undefined,
        isLocal: undefined, // set by markLocals(); declared here so the object keeps one shape
        isConst,
        isAbstract,
        isLateinit,
        isOverride,
        isPrivate,
        isDeprecated,
        constValue,
        isExpect,
        isActual,
        isPrimaryCtorParam: isPrimaryCtorParam || undefined,
      });
      advance(nl);
      annotationWindow.length = 0;
      if (lineTripleQuotes % 2 !== 0) inRawString = true;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Typealias ──────────────────────────────────────────────────────────
    const ta = RE_TYPEALIAS.exec(raw);
    if (ta) {
      const isDeprecated = annotationWindow.some(l => RE_DEPRECATED.test(l)) || undefined;
      symbols.push({ name: ta[1], kind: 'typealias', line: lineNum, character: raw.indexOf(ta[1], ta.index), isComposable: false, depth: braceDepth, aliasTarget: ta[2]?.trim(), isDeprecated });
      advance(nl);
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

    advance(nl);
    if (lineTripleQuotes % 2 !== 0) inRawString = true;
    pos = nl + 1;
    lineNum++;
  }

  markLocals(symbols);
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

// Count { } and ( ) in text[start..end) — operates on original text, no slice.
// The third element is true when a `/*` opened in this range is not closed
// before `end` (the caller then enters block-comment mode).
function countDepth(
  text: string, start: number, end: number, braces: number, parens: number,
): [number, number, boolean] {
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
    if (c === '/' && i + 1 < end) {
      // Stop at trailing line comment
      if (text[i + 1] === '/') break;
      // Skip a mid-line block comment: `fun f() { /* { */ }` must stay balanced
      if (text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        if (close === -1 || close >= end) return [braces, parens, true];
        i = close + 1;
        continue;
      }
    }
    if      (c === '{') braces++;
    else if (c === '}') { if (braces > 0) braces--; } // clamp — unmatched } in malformed input must not produce negative depth
    else if (c === '(') parens++;
    else if (c === ')') { if (parens > 0) parens--; } // same for unmatched )
  }
  return [braces, parens, false];
}

// O(1) lookup table — true means the character can start a Kotlin declaration
// Covers: @ a c d e f i l o p s t v (and uppercase for enum entries handled separately)
const DECL_START: Record<string, boolean> = Object.fromEntries(
  '@acdefilopstv'.split('').map(c => [c, true])
);

// True if line has more '(' than ')' after the given position (multi-line constructor)
function hasUnclosedParen(line: string, from: number): boolean {
  return unclosedParenDepth(line, from) > 0;
}

/** How many parentheses the line leaves open after `from`. */
function unclosedParenDepth(line: string, from: number): number {
  const code = stripTrailingLineComment(line);
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    if (code.charAt(i) === '(') depth++;
    else if (code.charAt(i) === ')') depth--;
  }
  return depth;
}

// Scan the line after the class name for `: SuperType, Interface`
// Skips balanced <> and () blocks so constructor params and generics are ignored
function extractSupertypes(line: string, nameEnd: number, quals?: string[]): string[] {
  let depth = 0;
  for (let i = nameEnd; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '<' || ch === '(') { depth++; }
    else if (ch === '>' || ch === ')') { depth--; }
    else if (depth === 0 && ch === '{') return [];
    else if (depth === 0 && ch === ':') {
      return parseTypeNames(line.substring(i + 1), quals);
    }
  }
  return [];
}

// Detect `object : Interface` (anonymous object) — emits a synthetic $anon$N symbol
// so lookupImplementations() can count anonymous implementors.
// Called once per line, before the branch dispatch, so a declaration keyword on
// the same line does not hide the object expression that follows it.
function emitAnonObjectIfPresent(raw: string, lineNum: number, braceDepth: number, symbols: RawSymbol[]): void {
  // Cheap reject first: most lines carrying the substring `object` are
  // `objectMapper`, `companion object {`, `object Foo {` — no `:` follows.
  let m = RE_ANON_OBJECT.exec(raw);
  if (!m) return;
  const code = stripTrailingLineComment(raw);
  if (code.length !== raw.length) {
    m = RE_ANON_OBJECT.exec(code);
    if (!m) return;
  }
  // `companion object : Factory` is emitted as the named `Companion` symbol by
  // its own branch; counting it here too would double every companion.
  if (/\bcompanion\s+$/.test(code.slice(0, m.index))) return;
  if (isInsideStringLiteral(code, m.index)) return;
  // extractSupertypes scans from position after 'object' looking for ':'
  const anonQuals: string[] = [];
  const supertypes = extractSupertypes(code, m.index + 'object'.length, anonQuals);
  if (supertypes.length === 0) return;
  symbols.push({
    name: `$anon$${lineNum}`,
    kind: 'object',
    line: lineNum,
    character: m.index,
    isComposable: false,
    depth: braceDepth,
    supertypes,
    superQualifiers: anonQuals.length > 0 ? anonQuals : undefined,
  });
}

// For multi-line constructors: scan forward for `) : Types` on subsequent lines
function lookAheadSupertypes(text: string, start: number, quals?: string[], depart = 1): string[] {
  // Only the parenthesis that closes the CONSTRUCTOR ends the header, and it
  // has to be found INSIDE the line: `) : Base(` closes one and opens another,
  // so the depth at end of line is unchanged and says nothing. A parameter
  // whose type is a function written over several lines closes with `)` too.
  let profondeur = depart;
  let p = start;
  const lire = (brut: string, suite: number): string[] => {
    let rest = stripTrailingLineComment(brut).trimEnd();
    if (!rest.includes('{') && (rest.endsWith(',') || rest.endsWith(':'))) rest += ' ' + collectHeaderContinuation(text, suite);
    return parseTypeNames(rest, quals);
  };
  for (let i = 0; i < 20 && p < text.length; i++) {
    let nl = text.indexOf('\n', p);
    if (nl === -1) nl = text.length;
    const code = stripTrailingLineComment(text.slice(p, nl));
    let d = profondeur, fermeture = -1;
    for (let c = 0; c < code.length; c++) {
      const ch = code[c];
      if (ch === '(') d++;
      else if (ch === ')') { d--; if (d === 0) { fermeture = c; break; } }
    }
    if (fermeture === -1) {
      profondeur = d;
      if (code.trimStart().startsWith('{')) return [];
      p = nl + 1;
      continue;
    }
    const reste = code.slice(fermeture + 1).trim();
    if (reste.startsWith(':')) return lire(reste.slice(1), nl + 1);
    // Anything else after the closing parenthesis ends the header: `{`, or a
    // body opening below. A bare close is not the end though, Kotlin lets the
    // supertype list lead the next line; only the very next non blank line may
    // carry it, otherwise the scan reaches a `: Type` belonging to something
    // further down and the class inherits a method's return type.
    if (reste !== '') return [];
    let q = nl + 1;
    for (let j = 0; j < 5 && q < text.length; j++) {
      let qn = text.indexOf('\n', q);
      if (qn === -1) qn = text.length;
      const suivante = stripTrailingLineComment(text.slice(q, qn)).trim();
      if (suivante === '') { q = qn + 1; continue; }
      return suivante.startsWith(':') ? lire(suivante.slice(1), qn + 1) : [];
    }
    return [];
  }
  return [];
}

// True when the header line ends (comment stripped) with `:` or `,` after
// the name and has not opened its body: the supertype list continues below.
function headerContinues(raw: string, nameEnd: number): boolean {
  const tail = stripTrailingLineComment(raw.slice(nameEnd)).trimEnd();
  if (tail.includes('{')) return false;
  return tail.endsWith(':') || tail.endsWith(',');
}

// The next lines of a wrapped header, joined, up to (excluding) its `{`.
// Stops after a line that does not end with `,` or `:`, or at a declaration.
function collectHeaderContinuation(text: string, start: number): string {
  let out = '';
  let p = start;
  for (let i = 0; i < 10 && p < text.length; i++) {
    let nl = text.indexOf('\n', p);
    if (nl === -1) nl = text.length;
    const t = stripTrailingLineComment(text.slice(p, nl)).trim();
    p = nl + 1;
    if (!t) continue;
    if (/^(?:fun|val|var|class|object|interface|@|\/\*|\*)/.test(t)) break;
    const brace = t.indexOf('{');
    if (brace !== -1) { out += ' ' + t.slice(0, brace); break; }
    out += ' ' + t;
    if (!t.endsWith(',') && !t.endsWith(':')) break;
  }
  return out;
}

// One name per top-level comma-separated entry: the type itself, without
// its generic arguments, constructor arguments or `by` delegate. Taking every
// capitalized word made `ListAdapter<Item, ItemViewHolder>(DiffCb)` a subtype
// of Item, and `BaseViewModel<UiState>(Dispatchers.IO)` a subtype of UiState,
// which the type hierarchy, the implementation lenses and the sealed `when`
// coverage all believed.
function parseTypeNames(s: string, quals?: string[]): string[] {
  const clean = s.split(/\bwhere\b/)[0].split('{')[0];
  const types: string[] = [];
  const finals = new Set<string>();
  let depth = 0, seg = '';
  const flush = () => {
    const m = /^\s*([\w.]+)/.exec(seg);
    // `RecyclerView.Adapter`: both segments, the hierarchy is looked up by
    // simple name and the outer one is what a nested type is filed under.
    if (m) {
      const parts = m[1].split('.').filter(p => /^[A-Z]/.test(p));
      for (let i = 0; i < parts.length; i++) {
        types.push(parts[i]);
        if (i === parts.length - 1) finals.add(parts[i]);
        else if (quals) quals.push(parts[i]);
      }
    }
    seg = '';
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '<' || ch === '(') { depth++; continue; }
    if (ch === '>' || ch === ')') { if (depth > 0) depth--; continue; }
    if (depth > 0) continue;
    if (ch === ',') { flush(); continue; }
    seg += ch;
  }
  flush();
  // `class Foo : Bar, Bar.Baz` names Bar for real as well: it is not a
  // qualifier in that list, so it must stay in the hierarchy.
  if (quals) {
    const kept = quals.filter(q => !finals.has(q));
    quals.length = 0;
    quals.push(...kept);
  }
  return types;
}

// Flags a val/var whose nearest enclosing symbol is a function or a property
// initializer as a local, not a member: the Outline, folding and selection
// ranges skip it. One pass with a per-depth table of the enclosing kinds (a
// backward walk per property was quadratic in a class with many members).
function markLocals(symbols: RawSymbol[]): void {
  // Latest symbol seen at each depth, and its position: the enclosing symbol
  // of one at depth d is the most recent of the shallower ones.
  const kindAtDepth: SymbolKind[] = [];
  const seenAtDepth: number[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    if ((s.kind === 'val' || s.kind === 'var') && !s.isPrimaryCtorParam) {
      let enclosing: SymbolKind | undefined;
      let latest = -1;
      for (let d = s.depth - 1; d >= 0; d--) {
        if (d < seenAtDepth.length && seenAtDepth[d] > latest) { latest = seenAtDepth[d]; enclosing = kindAtDepth[d]; }
      }
      if (enclosing === 'fun' || enclosing === 'composable' || enclosing === 'val' || enclosing === 'var') s.isLocal = true;
    }
    kindAtDepth[s.depth] = s.kind;
    seenAtDepth[s.depth] = i;
  }
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
      const ni = cm[0].length - n.length;
      const pre = seg.slice(0, ni);
      const inlineQuals: string[] = [];
      const st  = extractSupertypes(seg, ni + n.length, inlineQuals);
      symbols.push({
        name: n, kind: toClassKind(kw), line: lineNum,
        character: offset + ni,
        isComposable: false, depth: memberDepth,
        supertypes: st.length > 0 ? st : undefined,
        superQualifiers: inlineQuals.length > 0 ? inlineQuals : undefined,
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
      const preFun = seg.slice(0, fm[0].length - fm[1].length);
      symbols.push({
        name: fm[1], kind: RE_COMPOSABLE.test(preFun) ? 'composable' : 'fun', line: lineNum,
        character: offset + fm[0].length - fm[1].length,
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
      const propPre  = seg.slice(0, pm[0].length - pm[3].length);
      const isConst  = /\bconst\b/.test(propPre) || undefined;
      symbols.push({
        name: pm[3], kind: pm[1] === 'val' ? 'val' : 'var',
        line: lineNum,
        character: offset + pm[0].length - pm[3].length,
        isComposable: false, depth: memberDepth,
        isExtension: pm[2] ? true : undefined,
        isConst,
        constValue:  isConst ? extractConstValue(seg, pm[0].length) : undefined,
        isOverride:  /\boverride\b/.test(propPre) || undefined,
        isPrivate:   /\bprivate\b/.test(propPre)  || undefined,
        isLateinit:  /\blateinit\b/.test(propPre) || undefined,
        isAbstract:  /\babstract\b/.test(propPre) || undefined,
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

// Strips a trailing // line comment while respecting string literals.
// e.g. `"https://x.com" // comment` → `"https://x.com"`
// True when `index` falls inside a single or double quoted literal on this line.
// Keeps `val doc = "object : Listener"` from being counted as an implementation.
function isInsideStringLiteral(s: string, index: number): boolean {
  let inStr: string | false = false;
  for (let i = 0; i < index && i < s.length; i++) {
    if (inStr) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === inStr) inStr = false;
    } else if (s[i] === '"' || s[i] === "'") {
      inStr = s[i];
    }
  }
  return inStr !== false;
}

function stripTrailingLineComment(s: string): string {
  let inStr: string | false = false;
  for (let i = 0; i < s.length; i++) {
    if (inStr) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === inStr) inStr = false;
    } else {
      if (s[i] === '"' || s[i] === "'") inStr = s[i];
      else if (s[i] === '/' && s[i + 1] === '/') return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

// Returns true when `depth` is the body depth of the nearest enclosing interface.
// Used to auto-set isAbstract on val/var in interfaces (Kotlin implicit abstract).
function isInInterfaceBodyAt(symbols: RawSymbol[], depth: number): boolean {
  for (let i = symbols.length - 1; i >= 0; i--) {
    const s = symbols[i];
    if (s.depth === depth - 1) {
      return s.kind === 'interface';
    }
  }
  return false;
}

// Extracts the literal value from a const val declaration.
// `nameEnd` is the index right after the property name (end of the RE_PROP match).
function extractConstValue(raw: string, nameEnd: number): string | undefined {
  const eqI = raw.indexOf('=', nameEnd);
  if (eqI === -1) return undefined;
  const clean = stripTrailingLineComment(raw.slice(eqI + 1).trim()).trim();
  return clean.slice(0, 80) || undefined;
}

function toClassKind(keyword: string): SymbolKind {
  switch (keyword) {
    case 'data class':       return 'dataClass';
    case 'sealed class':
    case 'sealed interface': return 'sealedClass';
    case 'fun interface':    return 'interface';
    case 'enum class':       return 'enum';
    case 'annotation class': return 'annotation';
    case 'value class':      return 'class';
    case 'interface':        return 'interface';
    case 'object':           return 'object';
    default:                 return 'class';
  }
}
