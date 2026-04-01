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
const RE_COMPOSABLE = /@Composable\b/;
const RE_CLASS      = /^\s*(?:(?:public|private|internal|protected|open|abstract|inner|sealed|data|annotation|enum|actual|expect)\s+)*?(data\s+class|sealed\s+class|sealed\s+interface|fun\s+interface|enum\s+class|annotation\s+class|class|interface|object)\s+(\w+)/;
// After optional generics, allow an optional `ReceiverType.` prefix so that
// `fun Modifier.customBackground()` captures "customBackground", not "Modifier".
// Handles: simple (Modifier.), nullable (Modifier?.), generic (List<T>.), qualified (Modifier.Companion.)
const RE_FUN        = /^\s*(?:(?:public|private|protected|internal|override|actual|expect|suspend|inline|noinline|crossinline|infix|operator|tailrec|external)\s+)*fun\s+(?:<[^>]*>\s+)?(?:(?:\w+(?:<[^<>]*>)?[?]?\.)+)?(\w+)\s*[(<]/;
const RE_PROP       = /^\s*(?:(?:public|private|protected|internal|override|open|abstract|actual|expect|lateinit|const)\s+)*(val|var)\s+(\w+)\s*(?:[=:(<]|\bby\b)/;
const RE_TYPEALIAS  = /^\s*(?:(?:public|private|internal|actual)\s+)?typealias\s+(\w+)(?:<[^>]*>)?\s*=\s*(.+)/;
const RE_ENUM_ENTRY = /^\s*([A-Z][A-Z0-9_]*)(?:\s*[,(;({]|$)/;

// ─────────────────────────────────────────────────────────────────────────────

export function parse(uriString: string, text: string): ParsedFile {
  const symbols: RawSymbol[] = [];
  let packageName = '';
  const imports: string[] = [];

  let inBlockComment = false;
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

    // ── O(1) first-char pre-filter — skip lines that can't be declarations ─
    // Exception: when we are exactly at enum-entry depth, uppercase lines must
    // pass through so RE_ENUM_ENTRY can match CONNECTED, OFFLINE, RED, etc.
    const atEnumEntryDepth = enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1;
    if (!DECL_START[fc] && !atEnumEntryDepth) {
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      if (fc !== '@') annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Lazy slice — only allocate when we need regex ─────────────────────
    const raw = text.slice(pos, nl);

    // ── Package ────────────────────────────────────────────────────────────
    if (!packageName && fc === 'p') {
      const m = RE_PACKAGE.exec(raw);
      if (m) { packageName = m[1]; pos = nl + 1; lineNum++; continue; }
    }

    // ── Imports ────────────────────────────────────────────────────────────
    if (fc === 'i' && raw.charCodeAt(fns - pos + 1) === 109 /* 'm' */) {
      const m = RE_IMPORT.exec(raw);
      if (m) { imports.push(m[1]); pos = nl + 1; lineNum++; continue; }
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

      const isAbstract      = /\babstract\b/.test(raw.slice(0, cm.index)) || undefined;
      const isHiltViewModel = annotationWindow.some(l => /@HiltViewModel\b/.test(l)) || undefined;

      symbols.push({ name, kind, line: lineNum, character: raw.indexOf(name, cm.index), isComposable: false, depth: braceDepth, supertypes: supertypes.length > 0 ? supertypes : undefined, isAbstract, isHiltViewModel });

      if (kind === 'enum') enumBraceDepth = braceDepth;

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
      pos = nl + 1; lineNum++; continue;
    }

    // ── Enum entries ───────────────────────────────────────────────────────
    if (enumBraceDepth !== -1 && braceDepth === enumBraceDepth + 1) {
      const em = RE_ENUM_ENTRY.exec(raw);
      if (em) {
        symbols.push({ name: em[1], kind: 'enum', line: lineNum, character: raw.indexOf(em[1]), isComposable: false, depth: braceDepth });
        [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
        if (braceDepth <= enumBraceDepth) enumBraceDepth = -1;
        pos = nl + 1; lineNum++; continue;
      }
    }

    // ── Functions ──────────────────────────────────────────────────────────
    const fm = RE_FUN.exec(raw);
    if (fm) {
      const isComposable = annotationWindow.some(l => RE_COMPOSABLE.test(l));
      const preFun       = raw.slice(0, raw.lastIndexOf('fun'));
      const isSuspend    = /\bsuspend\b/.test(preFun)  || undefined;
      const isAbstract   = /\babstract\b/.test(preFun)  || undefined;
      const isInline     = /\binline\b/.test(preFun)    || undefined;
      const isInfix      = /\binfix\b/.test(preFun)     || undefined;
      const isExtension  = /fun\s+(?:<[^>]*>\s+)?(?:\w+(?:<[^<>]*>)?[?]?\.)/.test(raw) || undefined;
      const isOperator   = /\boperator\b/.test(preFun)  || undefined;
      const isOverride   = /\boverride\b/.test(preFun)  || undefined;
      symbols.push({
        name: fm[1],
        kind: isComposable ? 'composable' : 'fun',
        line: lineNum,
        character: raw.indexOf(fm[1], fm.index),
        isComposable,
        depth: braceDepth,
        isSuspend,
        isAbstract,
        isInline,
        isInfix,
        isExtension,
        isOperator,
        isOverride,
      });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
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
      const propDepth  = isPrimaryCtorParam ? braceDepth + 1 : braceDepth;
      const propPre    = raw.slice(0, raw.indexOf(pm[1]));
      const isConst    = /\bconst\b/.test(propPre)    || undefined;
      const isAbstract = /\babstract\b/.test(propPre) || undefined;
      const isLateinit = /\blateinit\b/.test(propPre) || undefined;
      const isOverride = /\boverride\b/.test(propPre) || undefined;
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
      });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Typealias ──────────────────────────────────────────────────────────
    const ta = RE_TYPEALIAS.exec(raw);
    if (ta) {
      symbols.push({ name: ta[1], kind: 'typealias', line: lineNum, character: raw.indexOf(ta[1], ta.index), isComposable: false, depth: braceDepth, aliasTarget: ta[2]?.trim() });
      [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
      if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
      annotationWindow.length = 0;
      pos = nl + 1; lineNum++; continue;
    }

    // ── Annotation window update ────────────────────────────────────────────
    if (fc === '@') {
      if (annotationWindow.length >= 3) annotationWindow.shift();
      annotationWindow.push(raw.trimStart());
    } else {
      annotationWindow.length = 0;
    }

    [braceDepth, parenDepth] = countDepth(text, pos, nl, braceDepth, parenDepth);
    if (enumBraceDepth !== -1 && braceDepth <= enumBraceDepth) enumBraceDepth = -1;
    pos = nl + 1;
    lineNum++;
  }

  return { uriString, packageName, imports, symbols };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    if (c === '"' || c === '\'') { inStr = c; continue; }
    // Stop at trailing line comment
    if (c === '/' && i + 1 < end && text[i + 1] === '/') break;
    if      (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
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
