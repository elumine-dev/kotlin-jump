import { parse, RawSymbol } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  buildLineStarts,
  matchBrace,
  offsetToPos,
  sanitizeForUsageScan,
} from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { SymbolSource } from './unusedSymbols';

/**
 * KJ-072: an interface a class implements for nothing.
 *
 * Cutting the last statement out of a listener leaves the listener. On the
 * reference project the unheard event rule emptied both scroll callbacks of a
 * fragment and stopped there:
 *
 *   public class Grid extends Base implements AbsListView.OnScrollListener {
 *       gridView.setOnScrollListener(this);
 *       @Override public void onScrollStateChanged(AbsListView v, int s) { }
 *       @Override public void onScroll(AbsListView v, int a, int b, int c) { }
 *   }
 *
 * The compiler is happy, the listener is registered, and it does nothing. What
 * a human removes is the whole apparatus: both overrides, the `implements`
 * clause, the registration, and the import that followed. The override cannot
 * go on its own, the interface still demands it, so the unit here is the
 * implementation as a whole.
 *
 * ## What makes it a fact and not a guess
 *
 * A do nothing listener and no listener at all are the same behaviour, so the
 * cut is observably neutral ONCE nothing can still see the class as an `I`.
 * Five guards establish that, and any one of them failing means no finding:
 *
 *  1. Every method the class overrides FOR THIS INTERFACE has an empty body.
 *     When the interface is declared in this workspace, that set is read from
 *     its declaration. When it is not (an SDK listener), it is the overrides
 *     whose signature names the interface's root type, which is the shape of
 *     every `Outer.OnSomethingListener`; an interface whose callbacks do not
 *     name it is a documented false negative.
 *  2. The interface's name appears nowhere else in the class: no cast, no
 *     field, no `is` check.
 *  3. No OTHER file names both the class and the interface. That is how a
 *     `(OnScrollListener) fragment` somewhere else stops the finding without
 *     any type resolution.
 *  4. A registration is a call whose argument is exactly `this` and whose
 *     method name ENDS WITH the interface's simple name, which is the naming
 *     rule every listener setter follows. A `foo(this)` that does not match is
 *     left alone, and a class that passes itself somewhere unreadable keeps
 *     its implementation.
 *  5. The class is not generated, not in a test source set, and its supertype
 *     clause is one the rewrite can put back together.
 *
 * The cut is therefore several places at once, across one file: the overrides,
 * the clause, and the registrations. All of them or none. The import that
 * becomes unused is left to the sweep, which reads Java imports since KJ-068.
 */

export interface IdleCut {
  start: number;
  end: number;
  /** Text replacing the range; empty for a plain deletion. */
  replacement: string;
  what: string;
}

export interface IdleImplementation {
  className: string;
  /** The interface as the supertype clause writes it, dots included. */
  interfaceName: string;
  path: string;
  /** 0-based line of the class declaration. */
  line: number;
  /** Every place that goes, in one file, in document order. */
  cuts: IdleCut[];
}

export interface IdleImplementationScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  truncated?: boolean;
}

const OVERRIDE_JAVA_RE = /^\s*@Override\b/;
const OVERRIDE_KT_RE = /\boverride\s/;

/** Last segment of a possibly dotted name: `AbsListView.OnScrollListener` gives the listener. */
function simpleOf(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1];
}

/** First segment, which is the outer type when the interface is nested. */
function rootOf(name: string): string {
  return name.split('.')[0];
}

function wordCount(text: string, word: string): number {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return (text.match(re) ?? []).length;
}

/** Whole lines holding `[start, end)`, newline included. */
function wholeLines(text: string, lineStarts: readonly number[], start: number, end: number) {
  const first = offsetToPos(lineStarts as number[], start).line;
  const last = offsetToPos(lineStarts as number[], Math.max(end - 1, start)).line;
  return {
    start: lineStarts[first],
    end: last + 1 < lineStarts.length ? lineStarts[last + 1] : text.length,
  };
}

interface Methode {
  sym: RawSymbol;
  /** Whole-line extent, annotations above included. */
  start: number;
  end: number;
  /** The declaration text, parameters included. */
  signature: string;
  empty: boolean;
}

/** The direct methods of `cls`, with the annotation lines above each. */
function methodsOf(
  text: string,
  clean: string,
  lineStarts: readonly number[],
  parsed: { symbols: RawSymbol[] },
  cls: RawSymbol,
  clsClose: number,
  isJava: boolean,
): Methode[] {
  const lines = text.split('\n');
  const out: Methode[] = [];
  for (const sym of parsed.symbols) {
    if (sym.kind !== 'fun' || sym.depth !== cls.depth + 1) continue;
    const at = lineStarts[sym.line] + sym.character;
    if (at < lineStarts[cls.line] || at > clsClose) continue;

    const span = declarationSpan(clean, lineStarts, {
      kind: 'fun', name: sym.name, line: sym.line, nameOffset: at, lastLine: lineStarts.length - 1,
    });
    if (!span) continue;
    const open = clean.indexOf('{', at);
    if (open === -1 || open > span.scanEnd) continue;
    const close = matchBrace(clean, open);
    if (close < 0) continue;

    // An annotation or a modifier line of its own above the declaration.
    let first = sym.line;
    while (first > 0 && /^\s*@[\w.]+(?:\([^()]*\))?\s*$/.test(lines[first - 1] ?? '')) first--;

    const marked = isJava
      ? lines.slice(first, sym.line + 1).some(l => OVERRIDE_JAVA_RE.test(l))
      : OVERRIDE_KT_RE.test(lines[sym.line] ?? '');
    if (!marked) continue;

    out.push({
      sym,
      start: lineStarts[first],
      end: wholeLines(text, lineStarts, close, close + 1).end,
      signature: text.slice(lineStarts[sym.line], open),
      // Blank on the RAW text too: a comment in the body is content.
      empty: text.slice(open + 1, close).trim() === '',
    });
  }
  return out;
}

/**
 * The class header with `I` taken out of its supertype clause, or undefined
 * when the line cannot be put back together. Java `implements A, I`, Kotlin
 * `: Base(), I`, and the single supertype forms are all handled; anything else
 * refuses, since a header this code cannot rewrite is one it must not touch.
 */
function headerWithout(ligne: string, iface: string): string | undefined {
  const esc = iface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The list forms come first: taking `implements I` out of `implements I, A`
  // as if it were alone would leave the header holding `, A`.
  const formes: RegExp[] = [
    new RegExp(`(implements\\s+[^{]*?)\\s*,\\s*${esc}\\b`),      // implements A, I
    new RegExp(`(implements\\s+)${esc}\\s*,\\s*`),                 // implements I, A
    new RegExp(`\\s+implements\\s+${esc}\\b`),                     // implements I
    new RegExp(`\\s*,\\s*${esc}\\b`),                              // : Base(), I
    new RegExp(`(:\\s*)${esc}\\s*,\\s*`),                          // : I, A
    new RegExp(`\\s*:\\s*${esc}\\b`),                              // : I
  ];
  for (const forme of formes) {
    if (!forme.test(ligne)) continue;
    const reste = ligne.replace(forme, forme.source.startsWith('(') ? '$1' : '');
    // The brace keeps the space that separated it from the clause.
    return reste.replace(/\s*\{\s*$/, ' {');
  }
  return undefined;
}

export function findIdleImplementations(
  input: IdleImplementationScanInput,
): IdleImplementation[] {
  if (input.truncated) return [];
  const out: IdleImplementation[] = [];

  /** Interfaces this workspace declares, with the methods they demand. */
  const interfaceMethods = new Map<string, Set<string>>();
  for (const src of input.sources) {
    if (!/\.(kt|java)$/.test(src.path) || isBuildArtifactPath(src.path)) continue;
    if (!src.text.includes('interface')) continue;
    const parsed = src.path.endsWith('.java') ? parseJava(src.path, src.text) : parse(src.path, src.text);
    for (const sym of parsed.symbols) {
      if (sym.kind !== 'interface') continue;
      const noms = new Set<string>();
      for (const m of parsed.symbols) {
        if (m.kind === 'fun' && m.depth === sym.depth + 1 && m.line > sym.line) noms.add(m.name);
      }
      interfaceMethods.set(sym.name, noms);
    }
  }

  for (const src of input.sources) {
    if (!/\.(kt|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path) || isGeneratedSource(src.text)) continue;
    if (isTestSourceSet(src.path, input.testSourceSets)) continue;
    if (!/\bimplements\s|:\s/.test(src.text)) continue;

    const isJava = src.path.endsWith('.java');
    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const lines = src.text.split('\n');

    for (const cls of parsed.symbols) {
      if (cls.kind !== 'class') continue;
      const supers = cls.supertypes ?? [];
      if (supers.length === 0) continue;
      const clsOpen = clean.indexOf('{', lineStarts[cls.line] + cls.character);
      if (clsOpen === -1) continue;
      const clsClose = matchBrace(clean, clsOpen);
      if (clsClose < 0) continue;
      const corps = src.text.slice(clsOpen, clsClose + 1);
      const corpsClean = clean.slice(clsOpen, clsClose + 1);

      const methodes = methodsOf(src.text, clean, lineStarts, parsed, cls, clsClose, isJava);
      if (methodes.length === 0) continue;

      for (const brut of supers) {
        // The parser keeps the qualifier of a dotted supertype beside the
        // name; the clause writes them together, so read it from the header.
        const entete = lines[cls.line] ?? '';
        const ecrit = new RegExp(`\\b([\\w.]*\\b${simpleOf(brut)})\\b`).exec(entete)?.[1] ?? brut;
        const simple = simpleOf(ecrit);
        const racine = rootOf(ecrit);
        // `: AbsListView.OnScrollListener` reaches the list as BOTH names.
        // The qualifier is not a supertype, and reading it as one rewrote the
        // header into `extends LoggingFragment.OnScrollListener`.
        if ((cls.superQualifiers ?? []).includes(brut)) continue;
        // A supertype the header calls is a CLASS, never an interface.
        if (new RegExp(`\\b${simple}\\s*\\(`).test(entete)) continue;

        const connue = interfaceMethods.get(simple);
        const vides = methodes.filter(m => m.empty);
        if (vides.length === 0) continue;

        let concernees: Methode[];
        if (connue !== undefined) {
          // Guard 1a: the workspace declares it, so its demands are readable.
          if (connue.size === 0) continue;
          concernees = methodes.filter(m => connue.has(m.sym.name));
          if (concernees.length !== connue.size) continue;
        } else {
          // Guard 1b: an SDK listener, recognised by its callbacks naming it.
          concernees = methodes.filter(m => wordCount(m.signature, racine) > 0);
          if (concernees.length === 0) continue;
        }
        if (concernees.some(m => !m.empty)) continue;

        // Guard 2: the interface is named nowhere else in the FILE, not just
        // outside the class. `EmptyShellUiComponent` is a nested class of the
        // very file that returns it as a `ShellUiComponent`, so a guard that
        // stopped at the class body let its clause go and javac answered
        // `incompatible types`. Import lines do not count: one exists only to
        // resolve the clause, and the sweep takes it once the clause is gone.
        let ailleursDansLeFichier = src.text
          .replace(/^[ \t]*import\b[^\n]*$/gm, '')
          .replace(entete, '');
        for (const m of concernees) {
          ailleursDansLeFichier = ailleursDansLeFichier.replace(src.text.slice(m.start, m.end), '');
        }
        if (wordCount(ailleursDansLeFichier, simple) > 0) continue;

        // Guard 3: no other file names both the class and the interface.
        const vuAilleurs = input.sources.some(s =>
          s.path !== src.path && /\.(kt|java)$/.test(s.path)
          && wordCount(s.text, cls.name) > 0 && wordCount(s.text, simple) > 0);
        if (vuAilleurs) continue;

        // Guard 5: a header the rewrite can put back together.
        const nouvelle = headerWithout(entete, ecrit);
        if (nouvelle === undefined || nouvelle === entete) continue;

        // Guard 4: the registrations, and nothing else that passes `this`.
        const inscriptions: IdleCut[] = [];
        let refuse = false;
        const appel = /([A-Za-z_]\w*)\s*\(\s*this\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = appel.exec(corpsClean)) !== null) {
          if (!m[1].endsWith(simple)) continue;
          const at = clsOpen + m.index;
          const plage = wholeLines(src.text, lineStarts, at, at + m[0].length);
          const ligne = src.text.slice(plage.start, plage.end).trim();
          // The line is that call and nothing else, its receiver included. A
          // registration sharing its line with other code is one this cannot
          // cut, and a class whose registration it cannot cut keeps it all.
          const seule = new RegExp(`^[\\w.]*\\b${m[1]}\\s*\\(\\s*this\\s*\\)\\s*;?$`);
          if (!seule.test(ligne)) { refuse = true; break; }
          inscriptions.push({ ...plage, replacement: '', what: `registration ${m[1]}` });
        }
        if (refuse) continue;

        const cuts: IdleCut[] = [
          ...concernees.map(x => ({ start: x.start, end: x.end, replacement: '', what: `override ${x.sym.name}` })),
          {
            ...wholeLines(src.text, lineStarts, lineStarts[cls.line], lineStarts[cls.line] + entete.length),
            replacement: `${nouvelle}\n`,
            what: `implements ${ecrit}`,
          },
          ...inscriptions,
        ].sort((a, b) => a.start - b.start);

        out.push({ className: cls.name, interfaceName: ecrit, path: src.path, line: cls.line, cuts });
      }
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function messageFor(f: IdleImplementation): string {
  const n = f.cuts.filter(c => c.what.startsWith('override')).length;
  return `Class '${f.className}' implements ${f.interfaceName} and does nothing with it: `
    + `${n} empty override${n > 1 ? 's' : ''}`;
}
