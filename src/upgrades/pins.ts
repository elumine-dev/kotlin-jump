import type { PinKind } from './model';

/**
 * What silences an entry.
 *
 * `# @pin` (TOML) or `// @pin` (build files), on the entry's line or alone on
 * the line directly above, holds an entry back. It is the comment the
 * version-catalog-update plugin reads, so a catalog pinned for one tool is
 * pinned for the other. `# @keep` is not a pin: that plugin defines it as
 * "do not remove", which is another question.
 *
 * The Kotlin Jump marker silences the entry it is written on, and the whole
 * file when it stands on a comment line of its own, the way KJ-041's marker
 * does. A `@pin` inside a string value, or the word `@pinned`, is not a pin.
 */

export const IGNORE_MARKER = 'kotlin-jump:ignore dependency-upgrade';

export type CommentStyle = 'toml' | 'code';

const PIN_RE = /(?:^|[^\w@])@pin(?!\w)/;

/** The comment of a line, outside strings; undefined when the line has none. */
function commentOf(line: string, style: CommentStyle): string | undefined {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (style === 'toml' && c === '#') return line.slice(i + 1);
    if (style === 'code' && c === '/' && line[i + 1] === '/') return line.slice(i + 2);
  }
  return undefined;
}

/** A line that holds a comment and nothing else. */
function isCommentOnly(line: string, style: CommentStyle): boolean {
  const trimmed = line.trim();
  return style === 'toml' ? trimmed.startsWith('#') : trimmed.startsWith('//');
}

export function pinOnLine(lines: readonly string[], line: number, style: CommentStyle): PinKind | undefined {
  if (line < 0 || line >= lines.length) return undefined;
  const own = commentOf(lines[line], style);
  if (own !== undefined) {
    if (own.includes(IGNORE_MARKER)) return 'ignore-marker';
    if (PIN_RE.test(own)) return 'pin-comment';
  }
  if (line > 0 && isCommentOnly(lines[line - 1], style)) {
    const above = commentOf(lines[line - 1], style) ?? '';
    // The marker alone on a line speaks for the file, not for this line.
    if (PIN_RE.test(above)) return 'pin-comment';
  }
  return undefined;
}

/** True when the marker stands on a comment line of its own: the whole file is silent. */
export function fileLevelMarker(lines: readonly string[], style: CommentStyle): boolean {
  return lines.some(l => isCommentOnly(l, style) && (commentOf(l, style) ?? '').includes(IGNORE_MARKER));
}
