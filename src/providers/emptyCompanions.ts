import { parse } from '../indexer/KotlinParser';
import { declarationSpan } from '../util/declarationSpan';
import { buildLineStarts, sanitizeForUsageScan } from '../util/kotlinScan';

/**
 * A `companion object` with nothing left in it.
 *
 * Every member family can take the last member of a companion, and none of
 * them looks at the block that held it: on an open source app, two
 * `private const val` went and `companion object {\n}` stayed, which detekt
 * reports as EmptyClassBlock. Nothing calls an empty companion, except as a
 * receiver (`fun Owner.Companion.x()`) or from Java (`Owner.Companion`), and
 * both spell `Owner.Companion` somewhere.
 *
 * Only the plain form is taken: a named, annotated or supertyped companion
 * says something by existing. A visibility does not: `private companion
 * object {}` was left empty the same way.
 */
export interface EmptyCompanion {
  path: string;
  /** Whole lines, from the start of the `companion` line to after its `}` line. */
  start: number;
  end: number;
  owner: string;
  /** 0-based. */
  line: number;
}

const EMPTY_RE = /^[ \t]*(?:(?:private|internal|protected|public)[ \t]+)?companion[ \t]+object[ \t]*\{[ \t\r\n]*\}[ \t]*(?:\r?\n|$)/gm;
const CLASS_LIKE = /class|object|interface|enum/i;

export function findEmptyCompanions(sources: readonly { path: string; text: string }[]): EmptyCompanion[] {
  const found: EmptyCompanion[] = [];
  for (const src of sources) {
    if (!src.path.endsWith('.kt') || !src.text.includes('companion')) continue;
    let symbols: { name: string; kind: string; line: number; depth: number }[] | undefined;
    for (const m of src.text.matchAll(EMPTY_RE)) {
      const start = m.index ?? 0;
      const previous = src.text.slice(0, start).replace(/\s+$/, '');
      const previousLine = previous.slice(previous.lastIndexOf('\n') + 1);
      if (/^\s*@/.test(previousLine)) continue;
      const line = src.text.slice(0, start).split('\n').length - 1;
      symbols ??= parse(`file://${src.path}`, src.text).symbols as any[];
      const companion = symbols.find(s => s.name === 'Companion' && s.line === line);
      if (!companion) continue;
      const owner = [...symbols].reverse().find(s => s.line < line && s.depth === companion.depth - 1 && CLASS_LIKE.test(s.kind));
      if (!owner) continue;
      found.push({ path: src.path, start, end: start + m[0].length, owner: owner.name, line });
    }
  }
  if (found.length === 0) return found;
  const code = sources.filter(s => /\.(kt|kts|java)$/.test(s.path));
  return found.filter(c => {
    const named = new RegExp(`\\b${c.owner}\\s*\\.\\s*Companion\\b`);
    return !code.some(s => named.test(s.text));
  });
}

/**
 * A class, object, interface or enum whose body is `{}` once its members went:
 * `data class X(val a: Int) {\n}` and `enum class E {  }`, which detekt
 * reports (NoEmptyClassBody, EmptyClassBlock). The declaration stays, only the
 * braces go: Kotlin needs no body. A body holding a comment is not empty.
 */
export interface EmptyBody {
  path: string;
  /** From the end of the header (its trailing blanks included) to after the `}`. */
  start: number;
  end: number;
  name: string;
}

const CLASS_KINDS = new Set(['class', 'dataClass', 'sealedClass', 'enum', 'interface', 'object']);

export function findEmptyBodies(sources: readonly { path: string; text: string }[]): EmptyBody[] {
  const out: EmptyBody[] = [];
  for (const src of sources) {
    if (!src.path.endsWith('.kt') || !/\{\s*\}/.test(src.text)) continue;
    const { symbols } = parse(`file://${src.path}`, src.text) as { symbols: { name: string; kind: string; line: number; character: number }[] };
    // `Companion` and `$anon$N` are names the text does not spell at their
    // position: the name check below leaves them out (a companion goes whole).
    const candidates = symbols.filter(s => CLASS_KINDS.has(s.kind));
    if (candidates.length === 0) continue;
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    for (const s of candidates) {
      const nameOffset = lineStarts[s.line] + s.character;
      if (src.text.slice(nameOffset, nameOffset + s.name.length) !== s.name) continue;
      const span = declarationSpan(clean, lineStarts, { kind: 'classLike', name: s.name, line: s.line, nameOffset, lastLine: lineStarts.length - 1 });
      if (!span || span.lineBasedEnd) continue;
      const close = span.scanEnd - 1;
      if (clean[close] !== '}') continue;
      const open = clean.lastIndexOf('{', close - 1);
      if (open <= nameOffset || src.text.slice(open + 1, close).trim() !== '') continue;
      let start = open;
      while (start > nameOffset && /\s/.test(src.text[start - 1])) start--;
      out.push({ path: src.path, start, end: close + 1, name: s.name });
    }
  }
  return out;
}

/**
 * The `;` that closed an enum's entries once every member after it went:
 * `STAR_PROJECT;` then `}` (detekt NoSemicolons). The entries stay, the `;`
 * goes; an enum left with `{ ; }` is then an empty body for the next round.
 */
export function findStrayEnumSemicolons(sources: readonly { path: string; text: string }[]): { path: string; start: number; end: number; name: string }[] {
  const out: { path: string; start: number; end: number; name: string }[] = [];
  for (const src of sources) {
    if (!src.path.endsWith('.kt') || !/enum\s+class/.test(src.text)) continue;
    const { symbols } = parse(`file://${src.path}`, src.text) as { symbols: { name: string; kind: string; line: number; character: number }[] };
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    for (const s of symbols) {
      if (s.kind !== 'enum') continue;
      const nameOffset = lineStarts[s.line] + s.character;
      if (src.text.slice(nameOffset, nameOffset + s.name.length) !== s.name) continue;
      if (!/enum\s+class\s+$/.test(clean.slice(lineStarts[s.line], nameOffset))) continue;
      const span = declarationSpan(clean, lineStarts, { kind: 'classLike', name: s.name, line: s.line, nameOffset, lastLine: lineStarts.length - 1 });
      if (!span || span.lineBasedEnd) continue;
      const close = span.scanEnd - 1;
      let k = close - 1;
      while (k > nameOffset && /\s/.test(src.text[k])) k--;
      if (src.text[k] !== ';' || clean[k] !== ';') continue;
      out.push({ path: src.path, start: k, end: k + 1, name: s.name });
    }
  }
  return out;
}
