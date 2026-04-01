// Returns true if position `pos` in `line` is inside a string literal or trailing // comment
export function isInsideCommentOrString(line: string, pos: number): boolean {
  let inStr: string | false = false;
  for (let i = 0; i < line.length; i++) {
    if (inStr) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === inStr) { inStr = false; continue; }
      if (i === pos) return true;
      continue;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
      if (i === pos) return true;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i;
    }
    if (i === pos) return false;
  }
  return !!inStr;
}
