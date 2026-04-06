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
