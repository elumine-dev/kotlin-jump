/**
 * KJ-027: unused locals and bindings.
 *
 * Three kinds, all provably scoped to a single block, so a whole-block scan is
 * a superset of any legal usage — zero false positives by design, false
 * negatives accepted (same philosophy as KJ-009/KJ-025/KJ-026):
 *   1. `local`        — `val`/`var` in a function body, never read
 *   2. `lambdaParam`  — named lambda parameter, never used in its lambda
 *   3. `catchBinding` — `catch (e: Type)` where `e` is never touched
 *
 * Never flagged: `it`, names already `_` or `_`-prefixed, backticked names,
 * destructuring declarations, class members (KJ-026's job), names declared
 * twice in the same body (shadowing), anything under `@Suppress`.
 *
 * The VS Code layer, and the fix titles that go with it, stay in
 * `./UnusedLocalProvider`. Nothing here may import `vscode`.
 */

import {
  buildLineStarts,
  offsetToPos,
  collectAnnotationTargets,
  fileOptsOut,
  UNUSED_VARIABLE,
  SUPPRESS_NAMES,
  sanitizeForUsageScan,
} from '../util/kotlinScan';

export type UnusedLocalKind = 'local' | 'lambdaParam' | 'catchBinding';
export type LocalFixKind = 'deleteLine' | 'keepCall' | 'renameUnderscore' | 'none';

export interface UnusedLocal {
  kind: UnusedLocalKind;
  name: string;
  /** 0-based position of the name token (diagnostic range). */
  line: number;
  character: number;
  fix: LocalFixKind;
  /** Absolute offsets of the edit; -1/-1 when `fix === 'none'`. */
  fixStart: number;
  fixEnd: number;
  fixText: string;
}

export interface Block {
  open: number;
  /** Offset of the matching `}`, or -1 when the file is unbalanced. */
  close: number;
  parent: number;
  /** Start of the header slab: just past the previous brace. */
  headerStart: number;
  /** Paren depth in effect when this block opened. */
  parenDepth: number;
}

export interface Structure {
  blocks: Block[];
  parenAt(offset: number): number;
}

/**
 * Structural keywords that open a block. The one that actually opens a given
 * block is the LAST one before its `{`: an `abstract fun` declaration sitting
 * earlier in the same header slab must not make a `companion object` look
 * like a function body.
 */
const BLOCK_KEYWORD_RE = /\b(fun|class|interface|object|enum|annotation|companion|init|get|set)\b/g;
const BODY_KEYWORDS = new Set(['fun', 'init', 'get', 'set']);
const MEMBER_KEYWORDS = new Set(['class', 'interface', 'object', 'enum', 'annotation', 'companion']);

/** `val`/`var` anchored to a statement start, so argument positions never match. */
const LOCAL_DECL_RE =
  /(?:^[ \t]*|[{;]\s*|->\s*)(?:@\w+(?:\([^()]*\))?\s+)*(val|var)\s+([A-Za-z_]\w*)\s*(?=[:=]|\bby\b)/gm;

/**
 * Lambda header at the start of a block: `a ->`, `a, b ->`, `a: Type ->`.
 * `-` is deliberately absent from the type character class so a functional
 * type (`{ cb: (Int) -> Unit ->`) never matches; missing it is a false
 * negative, misparsing it would be a false positive.
 */
const LAMBDA_HEADER_RE =
  /^\s*([A-Za-z_]\w*(?:\s*:\s*[\w.<>?,\s]+)?(?:\s*,\s*[A-Za-z_]\w*(?:\s*:\s*[\w.<>?,\s]+)?)*)\s*->/;

const CATCH_HEADER_RE = /\bcatch\s*\(\s*([A-Za-z_]\w*)\s*:\s*[^()]*\)\s*$/;

/**
 * True when the block opening at `openOffset` is a `when` body — its branches
 * use `->` and would otherwise read as lambda parameters.
 *
 * Walks backwards through the whole text rather than the block's header slab:
 * the subject may contain both nested parentheses (`when (r.peek())`) and a
 * lambda (`when (kind?.let { map(it) })`), and the latter moves the slab past
 * the `when` keyword entirely.
 */
function isWhenBlock(clean: string, openOffset: number): boolean {
  let i = openOffset - 1;
  while (i >= 0 && /\s/.test(clean[i])) i--;
  if (i < 0) return false;
  if (clean[i] === ')') {
    let depth = 0;
    for (; i >= 0; i--) {
      if (clean[i] === ')') depth++;
      else if (clean[i] === '(') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (i < 0) return false;
    i--;
    while (i >= 0 && /\s/.test(clean[i])) i--;
  }
  let end = i + 1;
  while (i >= 0 && /\w/.test(clean[i])) i--;
  return clean.slice(i + 1, end) === 'when';
}

/** Keywords that can appear where a lambda parameter name would. */
const NON_PARAM_WORDS = new Set(['else', 'is', 'in', 'null', 'true', 'false', 'this', 'when', 'it']);

/**
 * Calls known to have no side effect beyond building a value. Anything else
 * keeps its expression when the variable is removed.
 */
const PURE_FACTORIES = new Set([
  'listOf', 'listOfNotNull', 'mutableListOf', 'arrayListOf',
  'setOf', 'mutableSetOf', 'mapOf', 'mutableMapOf',
  'emptyList', 'emptySet', 'emptyMap',
  'arrayOf', 'intArrayOf', 'booleanArrayOf', 'longArrayOf', 'doubleArrayOf',
  'StringBuilder',
]);

/**
 * One pass over the sanitized text: every brace block with its extent, parent
 * and header slab, plus a paren-depth lookup. Everything else in this module
 * is a query over this map.
 */
export function scanStructure(clean: string): Structure {
  const blocks: Block[] = [];
  const stack: number[] = [];
  const parenOffsets: number[] = [];
  const parenDepths: number[] = [];
  let parenDepth = 0;
  let lastBrace = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '(') {
      parenDepth++;
      parenOffsets.push(i);
      parenDepths.push(parenDepth);
    } else if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
      parenOffsets.push(i);
      parenDepths.push(parenDepth);
    } else if (ch === '{') {
      blocks.push({
        open: i,
        close: -1,
        parent: stack.length > 0 ? stack[stack.length - 1] : -1,
        headerStart: lastBrace,
        parenDepth,
      });
      stack.push(blocks.length - 1);
      lastBrace = i + 1;
    } else if (ch === '}') {
      const idx = stack.pop();
      if (idx !== undefined) blocks[idx].close = i;
      lastBrace = i + 1;
    }
  }

  const parenAt = (offset: number): number => {
    let lo = 0;
    let hi = parenOffsets.length - 1;
    let depth = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (parenOffsets[mid] < offset) {
        depth = parenDepths[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return depth;
  };

  return { blocks, parenAt };
}

/** Innermost block containing `offset`, or -1. Blocks are in `open` order. */
export function innermostBlockAt(blocks: Block[], offset: number): number {
  let lo = 0;
  let hi = blocks.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].open < offset) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // walk out until the block actually contains the offset
  for (let i = candidate; i !== -1; i = blocks[i].parent) {
    const b = blocks[i];
    if (b.close === -1) return -1; // unbalanced: refuse to guess
    if (b.open < offset && offset < b.close) return i;
  }
  return -1;
}

/**
 * Walks out to the nearest function-like body. Returns -1 when the offset is
 * directly in a class body (KJ-026's territory) or when the structure cannot
 * be trusted.
 */
export function enclosingBody(clean: string, blocks: Block[], offset: number): number {
  for (let i = innermostBlockAt(blocks, offset); i !== -1; i = blocks[i].parent) {
    const b = blocks[i];
    if (b.close === -1) return -1;
    const header = clean.slice(b.headerStart, b.open);
    let last = '';
    BLOCK_KEYWORD_RE.lastIndex = 0;
    let k: RegExpExecArray | null;
    while ((k = BLOCK_KEYWORD_RE.exec(header)) !== null) {
      // an annotation use-site target (`@get:VisibleForTesting`) is not an
      // accessor, and `@field:`/`@set:` are not blocks either
      if (header[k.index - 1] === '@' || header[k.index + k[1].length] === ':') continue;
      last = k[1];
    }
    if (BODY_KEYWORDS.has(last)) return i;
    if (MEMBER_KEYWORDS.has(last)) return -1; // member territory, KJ-026's job
    // lambda, if/for/when/try, plain block → keep walking out
  }
  return -1;
}

/** Regions covered by a `@Suppress`-family annotation. */
export function suppressedRegions(clean: string, blocks: Block[], lineStarts: number[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const anno of collectAnnotationTargets(clean)) {
    if (!SUPPRESS_NAMES.has(anno.name)) continue;
    const { line } = offsetToPos(lineStarts, anno.target);
    const from = lineStarts[line];
    // the annotation covers the declaration it introduces, body included
    const block = blocks.find(b => b.open >= anno.target && b.headerStart <= anno.target);
    const to = block && block.close !== -1
      ? block.close + 1
      : (line + 1 < lineStarts.length ? lineStarts[line + 1] : clean.length);
    out.push({ from, to });
  }
  return out;
}

export function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `name` appears in `region` outside of the blanked declaration. */
function isUsedIn(region: string, name: string): boolean {
  return new RegExp(`\\b${escapeName(name)}\\b`).test(region);
}

export function blank(clean: string, from: number, to: number): string {
  return clean.slice(0, from) + ' '.repeat(to - from) + clean.slice(to);
}

/** Splits a lambda header's parameter list at depth-0 commas. */
function splitLambdaParams(header: string, headerStart: number): { name: string; offset: number }[] {
  const out: { name: string; offset: number }[] = [];
  let depth = 0;
  let segStart = 0;
  const push = (from: number, to: number) => {
    const seg = header.slice(from, to);
    const m = /^\s*([A-Za-z_]\w*)/.exec(seg);
    if (m) out.push({ name: m[1], offset: headerStart + from + m.index + m[0].length - m[1].length });
  };
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') { if (depth > 0) depth--; }
    else if (c === ',' && depth === 0) {
      push(segStart, i);
      segStart = i + 1;
    }
  }
  push(segStart, header.length);
  return out;
}

export function findUnusedLocals(text: string): UnusedLocal[] {
  if (!/\b(?:val|var|catch)\b|->/.test(text)) return [];
  if (fileOptsOut(text, UNUSED_VARIABLE)) return [];

  const clean = sanitizeForUsageScan(text);
  const lineStarts = buildLineStarts(text);
  const { blocks, parenAt } = scanStructure(clean);
  const suppressed = suppressedRegions(clean, blocks, lineStarts);
  const isSuppressed = (offset: number) => suppressed.some(r => offset >= r.from && offset < r.to);

  const lineEndOf = (line: number) => (line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length);
  const result: UnusedLocal[] = [];

  const pushFinding = (
    kind: UnusedLocalKind,
    name: string,
    nameOffset: number,
    fix: LocalFixKind,
    fixStart: number,
    fixEnd: number,
    fixText: string,
  ) => {
    const pos = offsetToPos(lineStarts, nameOffset);
    result.push({ kind, name, line: pos.line, character: pos.character, fix, fixStart, fixEnd, fixText });
  };

  // ── lambdaParam + catchBinding: both are block-shaped ────────────────────
  for (const block of blocks) {
    if (block.close === -1) continue;
    const header = clean.slice(block.headerStart, block.open);

    const catchMatch = CATCH_HEADER_RE.exec(header);
    if (catchMatch) {
      const name = catchMatch[1];
      const nameOffset = block.headerStart + catchMatch.index + catchMatch[0].indexOf(name);
      if (!name.startsWith('_') && !isSuppressed(nameOffset) && text[nameOffset - 1] !== '`') {
        const body = clean.slice(block.open, block.close);
        if (!isUsedIn(body, name)) {
          pushFinding('catchBinding', name, nameOffset, 'renameUnderscore', nameOffset, nameOffset + name.length, '_');
        }
      }
      continue;
    }

    if (isWhenBlock(clean, block.open)) continue; // `when` branches also use `->`
    const lambdaMatch = LAMBDA_HEADER_RE.exec(clean.slice(block.open + 1, block.close));
    if (!lambdaMatch) continue;
    const arrowEnd = block.open + 1 + lambdaMatch[0].length;
    const params = splitLambdaParams(lambdaMatch[1], block.open + 1 + lambdaMatch[0].indexOf(lambdaMatch[1]));
    const seen = new Map<string, number>();
    for (const p of params) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    const body = clean.slice(arrowEnd, block.close);
    for (const p of params) {
      if (p.name.startsWith('_') || NON_PARAM_WORDS.has(p.name)) continue;
      if ((seen.get(p.name) ?? 0) > 1) continue;
      if (isSuppressed(p.offset) || text[p.offset - 1] === '`') continue;
      if (isUsedIn(body, p.name)) continue;
      pushFinding('lambdaParam', p.name, p.offset, 'renameUnderscore', p.offset, p.offset + p.name.length, '_');
    }
  }

  // ── local ────────────────────────────────────────────────────────────────
  LOCAL_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LOCAL_DECL_RE.exec(clean)) !== null) {
    const keyword = m[1];
    const name = m[2];
    // anchored on the tail of the match so a name containing the keyword
    // (`val validated`) cannot shift the offsets
    const tail = new RegExp(`\\b${keyword}\\s+(${escapeName(name)})\\s*$`).exec(m[0]);
    if (!tail) continue;
    const declStart = m.index + tail.index;
    const nameOffset = declStart + tail[0].indexOf(name, keyword.length);

    if (name.startsWith('_') || text[nameOffset - 1] === '`') continue;
    if (isSuppressed(nameOffset)) continue;

    const bodyIdx = enclosingBody(clean, blocks, nameOffset);
    if (bodyIdx === -1) continue;
    const body = blocks[bodyIdx];
    if (parenAt(nameOffset) !== body.parenDepth) continue; // local class ctor, etc.

    // declaration extent: extend while brackets are unbalanced
    const declLine = offsetToPos(lineStarts, declStart).line;
    let extentEnd = Math.min(lineEndOf(declLine), body.close);
    let guard = 0;
    while (guard++ < 200) {
      const slice = clean.slice(declStart, extentEnd);
      const balanced =
        (slice.match(/\(/g)?.length ?? 0) === (slice.match(/\)/g)?.length ?? 0) &&
        (slice.match(/\{/g)?.length ?? 0) === (slice.match(/\}/g)?.length ?? 0) &&
        (slice.match(/\[/g)?.length ?? 0) === (slice.match(/\]/g)?.length ?? 0);
      if (balanced) break;
      // `extentEnd` sits at the START of the next line, so ask for the line of
      // its last character: using `extentEnd` directly skips one line per
      // round and blanks code past the declaration (false positives).
      const nextLine = offsetToPos(lineStarts, Math.max(extentEnd - 1, 0)).line + 1;
      if (nextLine >= lineStarts.length) break;
      const nextEnd = Math.min(lineEndOf(nextLine), body.close);
      if (nextEnd <= extentEnd) break;
      extentEnd = nextEnd;
    }
    const cleanDeclLine = clean.slice(lineStarts[declLine], lineEndOf(declLine));
    if (/;\s*\S/.test(cleanDeclLine)) continue;

    // shadowing / duplicate declaration inside the same body
    const bodyText = clean.slice(body.open, body.close);
    const headerText = clean.slice(body.headerStart, body.open);
    if (isUsedIn(headerText, name)) continue; // shadows a parameter
    const declCount = (bodyText.match(new RegExp(`\\b(?:val|var)\\s+${escapeName(name)}\\b`, 'g')) ?? []).length;
    if (declCount > 1) continue;

    const region = blank(clean, declStart, extentEnd).slice(body.open, body.close);
    if (isUsedIn(region, name)) continue;

    const { fix, fixStart, fixEnd, fixText } = computeLocalFix(text, clean, declStart, nameOffset, name, extentEnd, lineStarts, declLine);
    pushFinding('local', name, nameOffset, fix, fixStart, fixEnd, fixText);
  }

  return result.sort((a, b) => a.line - b.line || a.character - b.character);
}

/** Decides between deleting the line, keeping the expression, or no fix. */
function computeLocalFix(
  text: string,
  clean: string,
  declStart: number,
  nameOffset: number,
  name: string,
  extentEnd: number,
  lineStarts: number[],
  declLine: number,
): { fix: LocalFixKind; fixStart: number; fixEnd: number; fixText: string } {
  const none = { fix: 'none' as LocalFixKind, fixStart: -1, fixEnd: -1, fixText: '' };
  const afterName = nameOffset + name.length;
  const lineEnd = declLine + 1 < lineStarts.length ? lineStarts[declLine + 1] : text.length;

  // `by` delegate: removing it could drop a registration side effect
  if (/^\s*(?::[^=]*)?\bby\b/.test(clean.slice(afterName, lineEnd))) return none;

  let eq = -1;
  let depth = 0;
  for (let i = afterName; i < Math.min(lineEnd, extentEnd); i++) {
    const c = clean[i];
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') { if (depth > 0) depth--; }
    else if (c === '=' && depth === 0 && clean[i + 1] !== '=' && clean[i - 1] !== '!' && clean[i - 1] !== '<' && clean[i - 1] !== '>') {
      eq = i;
      break;
    }
  }
  if (eq === -1) return none; // declared without an initializer

  let initStart = eq + 1;
  while (initStart < extentEnd && /[ \t]/.test(text[initStart])) initStart++;
  // Cut a trailing comment, but keep string literals intact: a comment is
  // blanked in `clean` while its `//` is still in `text`, which tells the two
  // apart. Trimming on `clean` alone would eat `"draft"` down to nothing.
  let initEnd = extentEnd;
  for (let i = initStart; i < extentEnd - 1; i++) {
    if (text[i] === '/' && text[i + 1] === '/' && clean[i] === ' ' && clean[i + 1] === ' ') {
      initEnd = i;
      break;
    }
  }
  while (initEnd > initStart && /\s/.test(text[initEnd - 1])) initEnd--;
  const initText = text.slice(initStart, initEnd);

  if (isPureInitializer(initText) && initEnd <= lineEnd) {
    return { fix: 'deleteLine', fixStart: lineStarts[declLine], fixEnd: lineEnd, fixText: '' };
  }
  // keep whatever the initializer does, drop only `val name =`
  return { fix: 'keepCall', fixStart: declStart, fixEnd: initStart, fixText: '' };
}

/** Literals, bare identifiers, and a single call to a known pure factory. */
export function isPureInitializer(init: string): boolean {
  const text = init.trim();
  if (text.length === 0) return false;
  if (/[{}]|::|\?\./.test(text)) return false;
  // `val g = a++` mutates `a`: deleting the line would drop the increment
  if (/\+\+|--/.test(text)) return false;

  const factory = /^([A-Za-z_]\w*)\s*\((.*)\)$/s.exec(text);
  if (factory) {
    if (!PURE_FACTORIES.has(factory[1])) return false;
    return !/[({.]|::/.test(factory[2]);
  }
  if (/[.(]/.test(text)) return false; // property read or call: could run code
  // literals and identifiers, possibly combined by arithmetic or comparison
  return /^[\w"'\s+\-*/%<>=!&|,]+$/.test(text);
}
