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

// Returns true if position `pos` in `line` is inside a string literal,
// a trailing // comment, or an inline /* block comment */.
export function isInsideCommentOrString(line: string, pos: number): boolean {
  let inStr: string | false = false;
  let i = 0;
  while (i < line.length) {
    if (inStr) {
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === inStr) { inStr = false; i++; continue; }
      if (i === pos) return true;
      i++;
      continue;
    }
    // Inline block comment /* ... */
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '*') {
      const closeIdx = line.indexOf('*/', i + 2);
      if (closeIdx === -1) return pos >= i; // unclosed → rest of line is a comment
      if (pos >= i && pos < closeIdx + 2) return true;
      i = closeIdx + 2;
      continue;
    }
    // Trailing line comment //
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
      if (i === pos) return true;
      i++;
      continue;
    }
    if (i === pos) return false;
    i++;
  }
  return !!inStr;
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
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') break;
    if (line[i] === '"' || line[i] === '\'') { inStr = line[i]; i++; continue; }
    i++;
  }
  return false;
}
