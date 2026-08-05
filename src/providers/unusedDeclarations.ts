/**
 * KJ-026: unused private declaration detection, and the ranges its quick fix
 * removes.
 *
 * Flags `private` declarations never referenced in their file: functions,
 * properties (class members and top-level), classes, objects, interfaces.
 * `private` is at most file-visible, so a whole-file scan is a superset of
 * any legal scope — zero false positives by design, false negatives accepted
 * (same philosophy as KJ-009/KJ-025).
 *
 * Never flagged: overrides/operators/convention names (invoke, getValue,
 * componentN…), `main`, `serialVersionUID`, `_`-prefixed, backticked,
 * expect/actual/external/abstract, annotated declarations (except
 * @Composable/@Preview on functions), val/var members of annotated classes,
 * duplicate names anywhere in the file (overloads, shadowing), named
 * companions, anything under @Suppress. Recursion does not keep a function
 * alive (its own body is blanked before the scan).
 *
 * The VS Code layer stays in `./UnusedDeclarationProvider`. Nothing here may
 * import `vscode`.
 */

import { parse, RawSymbol } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { rangeEndLine } from '../util/symbolRanges';
import { declarationSpan } from '../util/declarationSpan';
import {
  buildLineStarts,
  offsetToPos,
  matchBrace,
  collectAnnotationTargets,
  fileOptsOut,
  UNUSED_DECLARATION,
  CONVENTION_FUN_NAMES,
  REFLECTIVE_SUPERTYPES,
  sanitizeForUsageScan,
} from '../util/kotlinScan';

export type UnusedDeclKind = 'fun' | 'val' | 'var' | 'class' | 'object' | 'interface';

export interface UnusedDecl {
  /** 0-based line/column of the name token (diagnostic range). */
  line: number;
  character: number;
  name: string;
  kind: UnusedDeclKind;
  /** Full-line removal extent incl. contiguous KDoc + annotations; -1/-1 when uncertain. */
  removeStart: number;
  removeEnd: number;
  /** Line above which the @Suppress fix inserts, and the indentation to copy. */
  suppressLine: number;
  suppressIndent: string;
}

/**
 * Annotations that do NOT make a declaration reachable. Note `@Preview` is
 * benign for KJ-025 (its parameters really are unused) but NOT here: the
 * Android Studio preview renderer calls the function, so an annotated
 * preview is an entry point, never dead code.
 */
const BENIGN_DECL_ANNOTATIONS = new Set(['Composable']);


const MODIFIER_GUARD_RE = /\b(?:override|operator|expect|actual|external|abstract|native|default)\b/;
const CANDIDATE_KINDS = new Set(['fun', 'composable', 'val', 'var', 'class', 'sealedClass', 'object', 'interface']);
const CLASS_LIKE = new Set(['class', 'sealedClass', 'dataClass', 'object', 'interface', 'enum', 'annotation']);
/** Characters legal inside a class header between name and body brace. */

function outputKind(kind: string): UnusedDeclKind {
  if (kind === 'composable') return 'fun';
  if (kind === 'sealedClass') return 'class';
  return kind as UnusedDeclKind;
}

/**
 * Line ranges of class-like declarations whose properties may be read without
 * ever being named in the source: annotated (codegen, DI, serialization) or
 * carrying a reflective supertype. Shared with KJ-028, which needs the same
 * exclusion — duplicating it would let the two copies drift.
 */
export function reflectiveOrAnnotatedClassRanges(
  clean: string,
  symbols: readonly RawSymbol[],
  lineStarts: number[],
  lastLine: number,
  annotationsFor: (sym: RawSymbol) => string[],
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    if (!CLASS_LIKE.has(s.kind)) continue;
    const reflective = (s.supertypes ?? []).some(t => REFLECTIVE_SUPERTYPES.has(t.replace(/<.*/, '')));
    if (annotationsFor(s).length === 0 && !reflective) continue;
    let to = rangeEndLine(symbols, i, lastLine);
    const brace = clean.indexOf('{', lineStarts[s.line] + s.character);
    if (brace !== -1) {
      const close = matchBrace(clean, brace);
      if (close !== -1) to = Math.max(to, offsetToPos(lineStarts, close).line);
    }
    ranges.push({ from: s.line, to });
  }
  return ranges;
}

export function findUnusedDeclarations(text: string, lang: 'kotlin' | 'java' = 'kotlin'): UnusedDecl[] {
  if (!/\bprivate\b/.test(text)) return [];
  if (fileOptsOut(text, UNUSED_DECLARATION)) return [];

  // Java is the same question with the same answer: a private member no word
  // of its own file names. The guards translate directly, and the ones that
  // do not apply (companion, expect/actual) simply never fire. A private
  // constructor is neutralised by rule 6 for free: its name is the class's,
  // which the class declaration itself already counts.
  const symbols = (lang === 'java' ? parseJava('inline', text) : parse('inline', text)).symbols;
  const clean = sanitizeForUsageScan(text);
  const lines = text.split('\n');
  const lineStarts = buildLineStarts(text);
  const lastLine = lines.length - 1;
  const annoTargets = collectAnnotationTargets(clean);

  const annosFor = (sym: RawSymbol): string[] => {
    const lo = lineStarts[sym.line];
    const hi = lo + sym.character;
    return annoTargets.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
  };

  // Rule 6: any name shared by two symbols (any kind, any depth, locals
  // included) is never flagged — kills overloads and shadowing conservatively.
  const nameCounts = new Map<string, number>();
  for (const s of symbols) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);

  // Rule 5: line ranges of class-like declarations whose properties may be
  // read reflectively — annotated (codegen) or Serializable/Parcelable.
  // Their val/var members are skipped; functions stay flaggable.
  const annotatedClassRanges: { from: number; to: number }[] = [];
  annotatedClassRanges.push(
    ...reflectiveOrAnnotatedClassRanges(clean, symbols, lineStarts, lastLine, annosFor),
  );
  const inAnnotatedClass = (line: number): boolean =>
    annotatedClassRanges.some(r => line > r.from && line <= r.to);

  const lineEndOf = (line: number): number =>
    line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;

  const result: UnusedDecl[] = [];

  for (const sym of symbols) {
    if (!sym.isPrivate || !CANDIDATE_KINDS.has(sym.kind)) continue;

    const declLine = lines[sym.line];
    const nameOffset = lineStarts[sym.line] + sym.character;
    const isFun = sym.kind === 'fun' || sym.kind === 'composable';
    const isProp = sym.kind === 'val' || sym.kind === 'var';

    // ── Exclusions ─────────────────────────────────────────────────────────
    // Primary-constructor properties belong to KJ-025 (which also removes the
    // matching arguments at call sites) — flagging them here would double-warn.
    if (sym.isPrimaryCtorParam) continue;
    if (sym.isOverride || sym.isOperator || sym.isAbstract || sym.isExpect || sym.isActual) continue;
    if (MODIFIER_GUARD_RE.test(declLine.slice(0, sym.character))) continue; // inline-body path: flags partial
    if (sym.name === 'main' || sym.name === 'serialVersionUID' || sym.name.startsWith('_')) continue;
    if (text[nameOffset - 1] === '`') continue;
    if (isFun && (CONVENTION_FUN_NAMES.has(sym.name) || /^component\d+$/.test(sym.name))) continue;
    const annoNames = annosFor(sym);
    if (isFun ? annoNames.some(a => !BENIGN_DECL_ANNOTATIONS.has(a)) : annoNames.length > 0) continue;
    if (isProp && inAnnotatedClass(sym.line)) continue;
    if ((nameCounts.get(sym.name) ?? 0) > 1) continue;
    if (sym.kind === 'object' && /\bcompanion\b/.test(declLine)) continue;
    const cleanDeclLine = clean.slice(lineStarts[sym.line], lineEndOf(sym.line));
    // `private val a = 1; val b = a` shares its line with more code. In Java a
    // semicolon ends EVERY statement, so an inline body `{ return s; }` would
    // trip this on each one-line method; there the brace already delimits.
    if (!(lang === 'java' && isFun) && /;\s*\S/.test(cleanDeclLine)) continue;

    // ── Scan extent (minimal-certain; under-blanking → FN, over → FP) ──────
    // Shared with KJ-032 via src/util/declarationSpan.ts: this extent is what
    // gets blanked before the usage scan, so a second copy that drifted would
    // be the most expensive bug in the family.
    const span = declarationSpan(clean, lineStarts, {
      kind: isFun ? 'fun' : isProp ? 'prop' : 'classLike',
      name: sym.name,
      line: sym.line,
      nameOffset,
      lastLine,
    });
    if (!span) continue;
    const { scanStart, scanEnd, lineBasedEnd } = span;

    // ── Usage scan on a copy with the candidate's own extent blanked ───────
    const scanStr = clean.slice(0, scanStart) + ' '.repeat(scanEnd - scanStart) + clean.slice(scanEnd);
    if (new RegExp(`\\b${sym.name}\\b`).test(scanStr)) continue;

    // ── Removal extent (full lines, KDoc + annotations included) ───────────
    let removeStart = -1;
    let removeEnd = -1;
    let firstLine = sym.line;
    for (let l = sym.line - 1; l >= 0; l--) {
      const trimmed = lines[l].trim();
      if (trimmed.startsWith('@')) { firstLine = l; continue; }
      if (trimmed.endsWith('*/')) {
        let k = l;
        while (k >= 0 && !lines[k].trim().startsWith('/*')) k--;
        if (k >= 0) { firstLine = k; l = k; continue; }
      }
      break;
    }
    let endOffset = scanEnd;
    if (isProp) {
      // absorb accessor lines below (`get() = …`, `private set`, block accessors)
      let nextLine = offsetToPos(lineStarts, endOffset - 1).line + 1;
      while (nextLine <= lastLine && /^\s*(?:private\s+|protected\s+)?(?:get|set)\b/.test(lines[nextLine])) {
        const lineStart = lineStarts[nextLine];
        const braceIdx = clean.slice(lineStart, lineEndOf(nextLine)).indexOf('{');
        if (braceIdx !== -1) {
          const close = matchBrace(clean, lineStart + braceIdx);
          if (close === -1) break;
          endOffset = close + 1;
        } else {
          endOffset = lineEndOf(nextLine);
        }
        nextLine = offsetToPos(lineStarts, endOffset - 1).line + 1;
      }
    }
    // A line-based extent is uncertain when the statement visibly continues:
    // trailing operator on the decl line, OR a continuation-style next line
    // (Kotlin allows `foo()\n  .bar()` — leading-dot chains).
    // Judge continuation on the RAW text: the sanitizer blanks string bodies,
    // so `val X = "done"` would read as ending on `=` and lose its quick fix.
    const trailing = text.slice(0, endOffset).trimEnd();
    const nextLineNum = offsetToPos(lineStarts, Math.max(endOffset - 1, 0)).line + 1;
    let nextNonBlank = nextLineNum;
    while (nextNonBlank <= lastLine && lines[nextNonBlank].trim() === '') nextNonBlank++;
    const nextStartsFresh =
      nextNonBlank > lastLine ||
      /^\s*(?:\}|\/\/|\/\*|@|va[lr]\b|fun\b|class\b|object\b|interface\b|companion\b|init\b|constructor\b|private\b|protected\b|internal\b|public\b|override\b|abstract\b|open\b|enum\b|sealed\b|data\b|suspend\b|inline\b|typealias\b)/.test(
        lines[nextNonBlank] ?? '',
      );
    const continues = lineBasedEnd && (/(?:[+\-*/,.&|?:=(]|->)$/.test(trailing) || !nextStartsFresh);
    if (!continues) {
      removeStart = lineStarts[firstLine];
      removeEnd = lineEndOf(offsetToPos(lineStarts, Math.max(endOffset - 1, removeStart)).line);
    }

    const pos = offsetToPos(lineStarts, nameOffset);
    result.push({
      line: pos.line,
      character: pos.character,
      name: sym.name,
      kind: outputKind(sym.kind),
      removeStart,
      removeEnd,
      suppressLine: firstLine,
      suppressIndent: /^[ \t]*/.exec(declLine)?.[0] ?? '',
    });
  }

  return result;
}
