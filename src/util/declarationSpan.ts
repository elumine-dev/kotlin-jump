import {
  findCtorParen,
  findMatchingParen,
  matchBrace,
  offsetToPos,
} from './kotlinScan';

/**
 * The extent of a Kotlin declaration, computed from sanitized text with no
 * parser and no vscode.
 *
 * This is the single most safety-critical helper in the dead-code family,
 * because the extent is what gets BLANKED before asking "is this name
 * mentioned anywhere else". Under-blanking loses a finding (false negative);
 * over-blanking swallows the NEXT declaration's body and hides a real usage,
 * which is a false positive that deletes live code. Every window below is
 * deliberately narrow for that reason.
 *
 * Extracted verbatim from KJ-026 so KJ-032 shares it rather than growing a
 * second copy that could drift.
 */

export type SpanKind = 'fun' | 'prop' | 'classLike';

export interface DeclarationSpan {
  /** Offset of the name token: the start of what gets blanked. */
  scanStart: number;
  /** Offset just past the declaration. */
  scanEnd: number;
  /**
   * True when the extent ends at end-of-line rather than at a matched brace.
   * Only then can the statement visibly continue, which is what makes a
   * REMOVAL uncertain even though the scan extent is fine.
   */
  lineBasedEnd: boolean;
}

/** A declaration whose extent could not be delimited returns undefined. */
export function declarationSpan(
  clean: string,
  lineStarts: readonly number[],
  opts: {
    kind: SpanKind;
    name: string;
    line: number;
    nameOffset: number;
    lastLine: number;
  },
): DeclarationSpan | undefined {
  const { kind, name, line, nameOffset, lastLine } = opts;
  const lineEndOf = (l: number) =>
    l + 1 < lineStarts.length ? lineStarts[l + 1] : clean.length;

  if (kind === 'fun') {
    let i = nameOffset + name.length;
    while (i < clean.length && /\s/.test(clean[i])) i++;
    if (clean[i] !== '(') return undefined;
    const closeParen = findMatchingParen(clean, i);
    if (closeParen === -1) return undefined;
    const after = clean.slice(closeParen + 1, closeParen + 801);
    const bodyRel = after.search(/[{=]/);
    if (bodyRel === -1) return undefined; // no body in reach (external stubs, headers)
    const bodyAbs = closeParen + 1 + bodyRel;

    if (after[bodyRel] === '{') {
      const close = matchBrace(clean, bodyAbs);
      if (close === -1) return undefined;
      return { scanStart: nameOffset, scanEnd: close + 1, lineBasedEnd: false };
    }
    // Expression body: a `{` only counts on the SAME line as the `=`. A wider
    // window would swallow the next declaration's brace and blank its usages.
    const exprLineEnd = lineEndOf(offsetToPos(lineStarts as number[], bodyAbs).line);
    const rel = clean.slice(bodyAbs, exprLineEnd).indexOf('{');
    if (rel !== -1) {
      const close = matchBrace(clean, bodyAbs + rel);
      if (close === -1) return undefined;
      return {
        scanStart: nameOffset,
        scanEnd: Math.max(close + 1, exprLineEnd),
        lineBasedEnd: false,
      };
    }
    return { scanStart: nameOffset, scanEnd: exprLineEnd, lineBasedEnd: true };
  }

  if (kind === 'prop') {
    // NEVER walk to the symbol's range end here: init blocks emit no symbol,
    // so it would blank a following `init { println(helper) }` usage.
    let scanEnd = lineEndOf(line);
    let lineBasedEnd = true;
    const brace = clean.slice(nameOffset, scanEnd).indexOf('{');
    if (brace !== -1) {
      const close = matchBrace(clean, nameOffset + brace);
      if (close === -1) return undefined;
      scanEnd = Math.max(scanEnd, close + 1);
      lineBasedEnd = false;
    }
    return { scanStart: nameOffset, scanEnd, lineBasedEnd };
  }

  // class / object / interface / enum
  let i = nameOffset + name.length;
  const ctorParen = findCtorParen(clean, i);
  if (ctorParen !== -1) {
    const closeParen = findMatchingParen(clean, ctorParen);
    if (closeParen === -1) return undefined;
    i = closeParen + 1;
  }
  // The body brace must be part of the HEADER: same line, or reached through
  // supertype-list continuation lines. Scanning the whole file for the next
  // `{` would swallow the following declaration's body and blank the usages
  // inside it (`private class Boom : Exception()` then
  // `fun log() { throw Boom() }` reads as unused).
  let headerEnd = lineEndOf(line);
  let brace = clean.slice(i, headerEnd).indexOf('{');
  while (brace === -1) {
    const headerText = clean.slice(i, headerEnd).trimEnd();
    const nextLine = offsetToPos(lineStarts as number[], headerEnd - 1).line + 1;
    if (nextLine > lastLine) break;
    // Kotlin wraps a supertype list by ending the line on `:` or `,`. Java
    // wraps it by STARTING the next line with `extends` or `implements`, so
    // the header would otherwise look finished and the span would collapse to
    // the first line, leaving the body unblanked and the type reading alive.
    const nextText = clean.slice(lineStarts[nextLine], lineEndOf(nextLine)).trimStart();
    const continues = /[:,]$/.test(headerText)
      || /^(?:extends|implements|,)\b/.test(nextText);
    if (!continues) break;
    headerEnd = lineEndOf(nextLine);
    brace = clean.slice(i, headerEnd).indexOf('{');
  }
  if (brace !== -1 && HEADER_CHARS_RE.test(clean.slice(i, i + brace))) {
    const close = matchBrace(clean, i + brace);
    if (close === -1) return undefined;
    return { scanStart: nameOffset, scanEnd: close + 1, lineBasedEnd: false };
  }
  return { scanStart: nameOffset, scanEnd: headerEnd, lineBasedEnd: true };
}

/**
 * Characters allowed between a class name and its body brace. Anything else
 * means the brace belongs to something other than this header.
 */
export const HEADER_CHARS_RE = /^[\s\w:,<>()?.[\]"'&*-]*$/;
