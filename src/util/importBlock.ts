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
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
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
      if (trimmed.startsWith('package ') || trimmed.startsWith('package;') || trimmed.startsWith('@file:') || trimmed.startsWith('@file :')) continue;
      return null;
    }
    break;
  }
  return first === -1 ? null : { first, last };
}
