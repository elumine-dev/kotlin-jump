import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { buildLineStarts, offsetToPos, sanitizeForUsageScan } from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isTestSourceSet } from '../util/testPaths';
import { plural } from '../util/plural';

/**
 * KJ-054: code that is present and never runs.
 *
 * Two shapes, neither of which any dead-code detector sees, because both are
 * invisible to a usage scan by construction:
 *
 *   an @Ignore or @Disabled test, which the runner skips and the compiler
 *   still builds, so it costs a build and covers nothing;
 *
 *   a block of commented-out code, which every detector strips before
 *   reading, so it is dead by definition and kept by habit. On the reference
 *   project one test file carried 343 such lines, more than any single miss
 *   of the removal families.
 *
 * Both are REPORTED, never removed by `Remove Everything Unused`: a test was
 * ignored by someone for a reason, and a comment may be a worked example or a
 * note. The command that surfaces them opens the Refactor Preview with every
 * box unticked. Removing either is always compile-safe (a test function has
 * no caller, a comment has no reader), so the preview is a judgement aid,
 * not a safety gate.
 */

export type DormantKind = 'ignoredTest' | 'ignoredClass' | 'commentedCode';

export interface DormantFinding {
  kind: DormantKind;
  path: string;
  /** 0-based position of the annotation or of the first commented line. */
  line: number;
  character: number;
  /** The test or class name, or a short label for a commented block. */
  name: string;
  /** What `@Ignore("…")` says, when it says anything. */
  reason?: string;
  /** Whole-line extent a removal would cut, annotations included. */
  removeStart: number;
  removeEnd: number;
  /** Lines the extent spans. */
  lines: number;
}

export interface DormantScanInput {
  sources: readonly { path: string; text: string }[];
  testSourceSets: readonly string[];
  /** Consecutive commented lines a block needs before it is reported. */
  minCommentedLines?: number;
  /** An incomplete corpus still lists what it read: nothing here proves absence. */
  truncated?: boolean;
}

const IGNORE_RE = /^\s*@(?:org\.junit\.(?:jupiter\.api\.)?)?(Ignore|Disabled)\b(?:\s*\(\s*(?:value\s*=\s*)?"((?:[^"\\]|\\.)*)"\s*\))?/;
const LINE_COMMENT_RE = /^\s*\/\/(?!\/)/;
/** Directives and notes that live in `//` on purpose. */
const NOT_CODE_COMMENT_RE = /^\s*\/\/\s*(?:region\b|endregion\b|noinspection\b|TODO\b|FIXME\b|eslint|@ts-|language=)/i;
/** A line that reads as code: a keyword, an annotation, or the punctuation code cannot do without. */
const CODE_KEYWORD_RE = /^\s*(?:@\w+|fun\b|val\b|var\b|return\b|if\b|else\b|for\b|while\b|when\b|class\b|object\b|interface\b|import\b|package\b|private\b|public\b|protected\b|internal\b|override\b|assert\w*\s*\(|verify\w*\s*\(|every\s*\{|coEvery\s*\{|mockk\b|Mockito\b|throw\b|try\b|catch\b)/;
const CODE_PUNCT_RE = /[=(){};]/;
/** Words that mark prose, absent from code lines. */
const PROSE_RE = /\b(?:the|and|to|of|is|are|this|that|with|for|le|la|les|de|des|est|pour|que|qui|une|un)\b/i;

function readsAsCode(s: string): boolean | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  if (CODE_KEYWORD_RE.test(t)) return true;
  if (CODE_PUNCT_RE.test(t) || t.endsWith(',')) return true;
  return false;
}

function readsAsProse(s: string): boolean {
  const t = s.trim();
  return PROSE_RE.test(t) && !CODE_PUNCT_RE.test(t);
}

/** True when a run of comment lines is, by its content, code and not notes. */
export function commentedRunIsCode(inner: readonly string[]): boolean {
  let yes = 0, no = 0, prose = 0;
  for (const l of inner) {
    const v = readsAsCode(l);
    if (v === true) yes++; else if (v === false) no++;
    if (readsAsProse(l)) prose++;
  }
  return yes >= 3 && yes >= 0.5 * (yes + no) && prose <= 0.3 * inner.length;
}

export function findDormantCode(input: DormantScanInput): DormantFinding[] {
  const minLines = input.minCommentedLines ?? 5;
  const out: DormantFinding[] = [];

  for (const src of input.sources) {
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    const lines = src.text.split('\n');
    const lineStarts = buildLineStarts(src.text);
    const isTest = isTestSourceSet(src.path, input.testSourceSets);

    // ── ignored tests and classes ───────────────────────────────────────
    if (isTest) {
      const parsed = src.path.endsWith('.java') ? parseJava(src.path, src.text) : parse(src.path, src.text);
      const clean = sanitizeForUsageScan(src.text);
      const cleanStarts = buildLineStarts(clean);
      const lastLine = cleanStarts.length - 1;
      for (const sym of parsed.symbols) {
        const isFun = sym.kind === 'fun' || sym.kind === 'composable';
        const isClass = sym.kind === 'class' || sym.kind === 'object';
        if (!isFun && !isClass) continue;
        // Walk the annotation lines directly above the declaration.
        let firstLine = sym.line;
        let ignoreLine = -1;
        let reason: string | undefined;
        for (let k = sym.line - 1; k >= 0; k--) {
          const t = (lines[k] ?? '').trim();
          if (t === '') break;
          if (!t.startsWith('@') && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) break;
          firstLine = k;
          const m = IGNORE_RE.exec(lines[k] ?? '');
          if (m) { ignoreLine = k; reason = m[2]; }
        }
        if (ignoreLine < 0) continue;
        const span = declarationSpan(clean, cleanStarts, {
          kind: isFun ? 'fun' : 'classLike',
          name: sym.name,
          line: sym.line,
          nameOffset: cleanStarts[sym.line] + sym.character,
          lastLine,
        });
        if (!span) continue;
        const endLine = offsetToPos(cleanStarts as number[], Math.max(span.scanEnd - 1, 0)).line;
        const removeStart = lineStarts[firstLine];
        const removeEnd = endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : src.text.length;
        out.push({
          kind: isFun ? 'ignoredTest' : 'ignoredClass',
          path: src.path,
          line: ignoreLine,
          character: (lines[ignoreLine] ?? '').search(/\S/),
          name: sym.name,
          reason: reason?.trim() || undefined,
          removeStart,
          removeEnd,
          lines: endLine - firstLine + 1,
        });
      }
    }

    // ── commented-out code, `//` runs ───────────────────────────────────
    let run: number[] = [];
    const flush = () => {
      if (run.length >= minLines) {
        const inner = run.map(i => (lines[i] ?? '').replace(/^\s*\/\//, ''));
        if (commentedRunIsCode(inner)) {
          const first = run[0], last = run[run.length - 1];
          out.push({
            kind: 'commentedCode',
            path: src.path,
            line: first,
            character: (lines[first] ?? '').search(/\S/),
            name: plural(run.length, 'commented line'),
            removeStart: lineStarts[first],
            removeEnd: last + 1 < lineStarts.length ? lineStarts[last + 1] : src.text.length,
            lines: run.length,
          });
        }
      }
      run = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (LINE_COMMENT_RE.test(l) && !NOT_CODE_COMMENT_RE.test(l)) run.push(i);
      else flush();
    }
    flush();

    // ── commented-out code, `/* … */` blocks (never KDoc `/**`) ─────────
    const blockRe = /^[ \t]*\/\*(?!\*)([\s\S]*?)\*\/[ \t]*$/gm;
    let bm: RegExpExecArray | null;
    while ((bm = blockRe.exec(src.text)) !== null) {
      const startLine = offsetToPos(lineStarts as number[], bm.index).line;
      const endLine = offsetToPos(lineStarts as number[], bm.index + bm[0].length - 1).line;
      const count = endLine - startLine + 1;
      if (count < minLines) continue;
      const inner = bm[1].split('\n').map(l => l.replace(/^\s*\*\s?/, ''));
      if (!commentedRunIsCode(inner)) continue;
      out.push({
        kind: 'commentedCode',
        path: src.path,
        line: startLine,
        character: (lines[startLine] ?? '').search(/\S/),
        name: plural(count, 'commented line'),
        removeStart: lineStarts[startLine],
        removeEnd: endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : src.text.length,
        lines: count,
      });
    }
  }

  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

/** The one line a report ends on. Exported for the witness. */
export function dormantSummary(findings: readonly DormantFinding[]): string {
  const tests = findings.filter(f => f.kind === 'ignoredTest').length;
  const classes = findings.filter(f => f.kind === 'ignoredClass').length;
  const blocks = findings.filter(f => f.kind === 'commentedCode');
  const commentedLines = blocks.reduce((n, f) => n + f.lines, 0);
  const parts = [
    tests > 0 ? plural(tests, 'ignored test') : '',
    classes > 0 ? plural(classes, 'ignored test class', 'ignored test classes') : '',
    blocks.length > 0 ? `${plural(blocks.length, 'commented-out block')} (${plural(commentedLines, 'line')})` : '',
  ].filter(Boolean);
  return parts.length === 0 ? 'Nothing dormant: no ignored test, no commented-out code.' : `Dormant: ${parts.join(', ')}.`;
}
