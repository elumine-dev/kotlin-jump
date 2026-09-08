/**
 * Bounds of the import block: the run of `import` lines in the file header,
 * blank and comment lines allowed in between, ending at the first line that
 * is anything else. The naive "first to last `^\s*import`" bound took an
 * `import` inside a raw string or a KDoc code sample for the end of the
 * block, and Organize Imports then replaced the class body in between.
 */
export function importBlockBounds(
  lines: readonly string[],
  isImportLine: (line: string) => boolean,
): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  let inBlockComment = false;
  // `@file:Suppress(` / `"DEPRECATION"` / `)` (ktlint style): the argument
  // lines are header too, not the end of it.
  let annotationDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (annotationDepth > 0) {
      annotationDepth += parenBalance(trimmed);
      continue;
    }
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (isImportLine(lines[i])) {
      if (first === -1) first = i;
      last = i;
      continue;
    }
    if (first === -1) {
      // Header lines before the first import: package, file annotations.
      if (trimmed.startsWith('@file:') || trimmed.startsWith('@file :')) { annotationDepth = Math.max(0, parenBalance(trimmed)); continue; }
      if (trimmed.startsWith('package ') || trimmed.startsWith('package;')) continue;
      return null;
    }
    break;
  }
  return first === -1 ? null : { first, last };
}

function parenBalance(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') n++; else if (s[i] === ')') n--;
  }
  return n;
}
