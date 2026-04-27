// Returns true when `pos` is inside a // or /* ... */ comment region.
// Unlike isInsideCommentOrString, string content is treated as opaque
// (so "//" inside a string is NOT a comment), and returns false when
// pos is the opening quote of a string literal.
export function isInsideComment(line: string, pos: number): boolean {
  let inStr: string | false = false;
  let i = 0;
  while (i < line.length) {
    if (inStr) {
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === inStr) inStr = false;
      i++;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx === -1) return pos >= i;
      if (pos >= i && pos < closeIdx + 2) return true;
      i = closeIdx + 2;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
    }
    i++;
  }
  return false;
}

// Counts non-overlapping """ occurrences in a line (raw-string state tracking).
export function countTripleQuotes(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}

// ── Token cache for isInsideCommentOrString ──────────────────────────────────
//
// Hot path: file scanners (FindUsagesEngine, RenameProvider, etc.) call this
// once per regex match. The original implementation re-walked the line from
// `i = 0` to `pos` on every call — O(line × matches_per_line). On a long
// line with N matches, that's O(N × line) char-scans (~10K on a 500-char
// XML/Gradle line with 20 matches).
//
// We pre-compute a per-line `Uint8Array` flagging "inside string-or-comment"
// once, then every subsequent check is O(1) array lookup. Memoised by line
// content (idempotent — same string always parses identically) with a
// bounded LRU-ish cache to keep heap flat on large workspaces.
//
// `Uint8Array` over `boolean[]`: 1 byte per char vs 8 bytes for a sparse
// JS array, and contiguous memory (cache-friendly).
interface LineTokens {
  /** 0 = code, 1 = inside string-or-comment, indexed by char position. */
  t: Uint8Array;
  /** Final inStr / inComment state — true when the line ended with an
   *  unclosed `"`, `'`, or `/*`. The original implementation returned
   *  this for any `pos >= line.length`. */
  trailing: boolean;
}

const _tokenCache = new Map<string, LineTokens>();
const _TOKEN_CACHE_LIMIT = 4096;

function buildLineTokens(line: string): LineTokens {
  const t = new Uint8Array(line.length); // default 0 = code
  let inStr: string | false = false;
  let i = 0;
  while (i < line.length) {
    if (inStr) {
      if (line[i] === '\\') {
        t[i] = 1;
        if (i + 1 < line.length) t[i + 1] = 1;
        i += 2; continue;
      }
      if (line[i] === inStr) {
        // Closing quote: original treated it as code (no `i === pos` check).
        inStr = false; i++; continue;
      }
      t[i] = 1; i++; continue;
    }
    // Inline block comment /* ... */
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx === -1) {
        for (let j = i; j < line.length; j++) t[j] = 1;
        return { t, trailing: true }; // unclosed → past-EOL is still in comment
      }
      const end = closeIdx + 2;
      for (let j = i; j < end; j++) t[j] = 1;
      i = end; continue;
    }
    // Trailing line comment //
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      for (let j = i; j < line.length; j++) t[j] = 1;
      // Past-EOL is also inside the comment — the original returned
      // `pos >= i` for ANY pos past the `//`, including pos > line.length
      // (used by SignatureHelp when the cursor sits at end-of-line after
      // `// foo(`).
      return { t, trailing: true };
    }
    if (line[i] === '"' || line[i] === '\'') {
      // Opening quote: original returned true for pos === i. Mirror that.
      t[i] = 1;
      inStr = line[i];
      i++; continue;
    }
    // Plain code (t[i] already 0)
    i++;
  }
  return { t, trailing: !!inStr };
}

function tokensFor(line: string): LineTokens {
  let lt = _tokenCache.get(line);
  if (lt !== undefined) return lt;
  lt = buildLineTokens(line);
  if (_tokenCache.size >= _TOKEN_CACHE_LIMIT) _tokenCache.clear();
  _tokenCache.set(line, lt);
  return lt;
}

// Returns true if position `pos` in `line` is inside a string literal,
// a trailing // comment, or an inline /* block comment */.
export function isInsideCommentOrString(line: string, pos: number): boolean {
  if (pos < 0) return false;
  const lt = tokensFor(line);
  if (pos >= line.length) return lt.trailing;
  return lt.t[pos] === 1;
}

// Returns true if position `pos` is inside a ${...} expression embedded in a
// string literal (Kotlin string template). Returns false for positions in plain
// string content, comments, or regular code.
export function isInsideStringInterpolation(line: string, pos: number): boolean {
  let inStr: string | false = false;
  let interpDepth = 0;
  let i = 0;
  while (i < line.length) {
    if (inStr !== false) {
      if (interpDepth > 0) {
        if (line[i] === '{') interpDepth++;
        else if (line[i] === '}') { interpDepth--; i++; continue; }
        if (i === pos) return true;
        i++; continue;
      }
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === inStr) { inStr = false; i++; continue; }
      if (line[i] === '$' && i + 1 < line.length && line[i + 1] === '{') {
        interpDepth++; i += 2; continue;
      }
      i++; continue;
    }
    // Block comment: `/* "${X}" */` looks like an interpolation if
    // we naively follow the `"` — but the string is dead text. Skip
    // the whole comment region so `pos` inside it returns false.
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx === -1) return false;
      if (pos >= i && pos < closeIdx + 2) return false;
      i = closeIdx + 2;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') break;
    if (line[i] === '"' || line[i] === '\'') { inStr = line[i]; i++; continue; }
    i++;
  }
  return false;
}
