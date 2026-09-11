import * as vscode from 'vscode';
import { stripKotlinComments } from '../util/xmlRefs';
import { capMap, OPEN_FILE_CACHE_LIMIT } from '../util/boundedCache';
import { fingerprint } from '../util/boundedCache';

/**
 * KJ-014: UDF X-Ray, who writes / who reads a ViewModel state.
 * Text analysis: backing `_x` plus exposure `x = _x.asStateFlow()`, direct
 * writes (.value=, .update, .postValue, .emit/.tryEmit) and indirect ones
 * (1 level: a local function that calls a writer).
 */

export type StateKind = 'stateflow' | 'livedata' | 'sharedflow';

export interface StateProvenance {
  property: string;
  exposedAs?: string;
  directWrites: number;
  indirectWriteFns: string[];
  kind: StateKind;
  /** 0-based line of the declaration, used by the CodeLens. */
  line?: number;
}

// (?:^|[{;]): compact declarations `class A { private val _x = … }` count
// too, not only line starts.
//
// The modifier list used to stop at private/internal/protected, so
// `override val state: StateFlow<UiState> = MutableStateFlow(UiState())`, the
// shape of a ViewModel that implements a contract, matched nothing at all.
// Measured on a real project: 306 declarations were seen and 13 more appear
// with the full list, 4 percent of the states having had no lens.
const MODIFIER =
  '(?:private|internal|protected|public|override|open|final|lateinit|const|actual|expect)\\s+';
const DECL_RE = new RegExp(
  `(?:^|[{;])\\s*(?:${MODIFIER})*va[lr]\\s+(\\w+)(?:\\s*:\\s*[^=]+?)?\\s*=\\s*` +
  '(MutableStateFlow|MutableLiveData|MutableSharedFlow|mutableStateOf)\\s*[(<]',
);

const KIND_MAP: Record<string, StateKind> = {
  MutableStateFlow: 'stateflow',
  mutableStateOf: 'stateflow',
  MutableLiveData: 'livedata',
  MutableSharedFlow: 'sharedflow',
};

interface FunSpan {
  name: string;
  body: string;
}

function extractFunctions(text: string): FunSpan[] {
  const spans: FunSpan[] = [];
  const re = /\bfun\s+(\w+)\s*\([^)]*\)[^{=\n]*(\{|=)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[2] === '=') {
      // expression body: up to the end of the line
      const end = text.indexOf('\n', m.index);
      spans.push({ name: m[1], body: text.slice(m.index, end < 0 ? undefined : end) });
      continue;
    }
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          spans.push({ name: m[1], body: text.slice(open, i + 1) });
          break;
        }
      }
    }
  }
  return spans;
}

// value = / += / -= / *= / /=, but not ==. The negative lookahead must not
// CONSUME the next character: with `[^=]`, `_a.value=_b.emit(x)` swallowed the
// `_` of `_b`, and the write to `_b` vanished from the count and the peek.
const WRITE_TAIL =
  '\\.(value\\s*[+\\-*/]?=(?!=)|update\\s*[({]|postValue\\s*\\(|setValue\\s*\\(|emit\\s*\\(|tryEmit\\s*\\()';
const READ_TAIL = '\\.(collectAsState|collectAsStateWithLifecycle|collect|observe)\\b';

// One pass over the text instead of one pass per property. The analysis used
// to build a fresh RegExp per property and rescan the whole file with it, so a
// ViewModel with 30 states scanned itself 30 times per keystroke.
const ANY_WRITE_RE = new RegExp(`\\b(\\w+)${WRITE_TAIL}`, 'g');
const ANY_READ_RE = new RegExp(`\\b(\\w+)${READ_TAIL}`, 'g');
const CALL_RE = /\b(\w+)\s*\(/g;

function countByName(text: string, re: RegExp): Map<string, number> {
  const out = new Map<string, number>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  return out;
}

function namesMatching(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

function countDirectWrites(property: string, text: string): number {
  // `// _count.value = 0 used to be here` counted as a write.
  return countByName(stripKotlinComments(text), ANY_WRITE_RE).get(property) ?? 0;
}

export function analyzeStateProvenance(vmText: string, stripped?: string): StateProvenance[] {
  // Stripped once, then reused everywhere below. stripKotlinComments keeps
  // offsets and line breaks, so line numbers stay those of the real file, and
  // a declaration written inside a comment no longer counts as a state.
  // The CodeLens path already holds the stripped text and passes it in: doing
  // it twice per keystroke cost as much as the whole analysis.
  const code = stripped ?? stripKotlinComments(vmText);
  const lines = code.split('\n');
  const fileWrites = countByName(code, ANY_WRITE_RE);
  const results: StateProvenance[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = DECL_RE.exec(lines[i]);
    if (!m) continue;
    const property = m[1];
    const kind = KIND_MAP[m[2]];

    // Exposure: `val hp… = _hp.asStateFlow()` / `= _hp` (bare LiveData).
    let exposedAs: string | undefined;
    if (property.startsWith('_')) {
      // A trailing line comment must not break detection.
      const expoRe = new RegExp(
        `va[lr]\\s+(\\w+)(?:\\s*:\\s*[^=]+?)?\\s*=\\s*${property}(?:\\.as\\w+\\(\\))?\\s*(?:\\/\\/.*)?$`,
        'm',
      );
      const expo = expoRe.exec(code);
      if (expo) exposedAs = expo[1];
    }

    results.push({
      property,
      ...(exposedAs !== undefined ? { exposedAs } : {}),
      directWrites: fileWrites.get(property) ?? 0,
      indirectWriteFns: [],
      kind,
      line: i,
    });
  }

  // No state, no indirect writes to look for. Scanning every function body of
  // a large Compose file that declares none was pure waste.
  if (results.length === 0) return results;

  // Indirect writes: F calls G, G writes P directly, F does not.
  // Each body is scanned twice in total (what it writes, what it calls), not
  // once per state and per writer: the old shape recompiled a RegExp for every
  // state x function x writer triple.
  const fns = extractFunctions(code).map(f => ({
    name: f.name,
    writes: namesMatching(f.body, ANY_WRITE_RE),
    // Skip the opening brace so the signature is not read as a call.
    calls: namesMatching(f.body.slice(f.body.indexOf('{') + 1), CALL_RE),
  }));
  for (const state of results) {
    const writers = new Set(fns.filter(f => f.writes.has(state.property)).map(f => f.name));
    if (writers.size === 0) continue;
    for (const f of fns) {
      if (writers.has(f.name)) continue;
      for (const callee of f.calls) {
        if (writers.has(callee)) { state.indirectWriteFns.push(f.name); break; }
      }
    }
  }
  return results;
}

/** Readers of an exposed property: collectAsState / collect / observe. */
export function findReaders(exposedName: string, fileText: string): number {
  return collectReaderSites(exposedName, fileText).length;
}

export interface SitePosition {
  line: number;
  character: number;
}

/** Read positions, used by the reference peek when clicking the lens. */
export function collectReaderSites(exposedName: string, fileText: string): SitePosition[] {
  const re = new RegExp(
    `\\b${exposedName}\\.(collectAsState|collectAsStateWithLifecycle|collect|observe)\\b`,
    'g',
  );
  return collectMatches(fileText, re);
}

/** Positions of the direct writes of a property. */
export function collectWriteSites(property: string, fileText: string): SitePosition[] {
  // Same tail as ANY_WRITE_RE, negative lookahead included: this copy still
  // had `[^=]`, which consumes the next character, so it disagreed with the
  // count shown on the lens for two writes glued together.
  const re = new RegExp(`\\b${property}${WRITE_TAIL}`, 'g');
  return collectMatches(fileText, re);
}

function collectMatches(text: string, re: RegExp): SitePosition[] {
  const out: SitePosition[] = [];
  // The cursor only moves forward, so the whole scan is linear. Slicing the
  // text from 0 on every match made a file with many writes quadratic.
  let line = 0;
  let lineStart = 0;
  let scanned = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    while (scanned < m.index) {
      if (text.charCodeAt(scanned) === 10) { line++; lineStart = scanned + 1; }
      scanned++;
    }
    out.push({ line, character: m.index - lineStart });
  }
  return out;
}

/** Every write position of the file, grouped by property. One pass. */
export function collectWriteSitesByName(text: string): Map<string, SitePosition[]> {
  return collectMatchesByName(text, ANY_WRITE_RE);
}

/** Every read position of the file, grouped by exposed name. One pass. */
export function collectReaderSitesByName(text: string): Map<string, SitePosition[]> {
  return collectMatchesByName(text, ANY_READ_RE);
}

function collectMatchesByName(text: string, re: RegExp): Map<string, SitePosition[]> {
  const out = new Map<string, SitePosition[]>();
  let line = 0;
  let lineStart = 0;
  let scanned = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    while (scanned < m.index) {
      if (text.charCodeAt(scanned) === 10) { line++; lineStart = scanned + 1; }
      scanned++;
    }
    const at = { line, character: m.index - lineStart };
    const bucket = out.get(m[1]);
    if (bucket) bucket.push(at);
    else out.set(m[1], [at]);
  }
  return out;
}

export class StateProvenanceProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  /** VS Code asks for lenses again on every scroll and every keystroke. */
  private readonly _cache = new Map<string, { version: number; fp: number; lenses: vscode.CodeLens[] }>();

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('stateProvenance', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const key = document.uri.toString();
    const text = document.getText();
    const hit = this._cache.get(key);
    // Version alone is not identity: a reopened document starts back at 1, so
    // a file changed by git while the tab was closed replayed the old lenses.
    const fp = fingerprint(text);
    if (hit && hit.version === document.version && hit.fp === fp) return hit.lenses;

    const lenses = this._compute(text, document.uri);
    this._cache.set(key, { version: document.version, fp, lenses });
    capMap(this._cache, OPEN_FILE_CACHE_LIMIT);
    return lenses;
  }

  private _compute(text: string, uri: vscode.Uri): vscode.CodeLens[] {
    if (!/Mutable(StateFlow|LiveData|SharedFlow)|mutableStateOf/.test(text)) return [];

    // Same stripped text for the counts and for the peek, so the lens title
    // and the list of locations behind it can no longer disagree. Stripped
    // once and handed to the analysis, which would otherwise redo it.
    const code = stripKotlinComments(text);
    const writesByName = collectWriteSitesByName(code);
    const readersByName = collectReaderSitesByName(code);

    return analyzeStateProvenance(text, code)
      .filter(s => s.line !== undefined)
      .flatMap(s => {
        const readerName = s.exposedAs ?? s.property;
        const writeSites = writesByName.get(s.property) ?? [];
        const readerSites = readersByName.get(readerName) ?? [];
        const indirect = s.indirectWriteFns.length > 0 ? ` (+${s.indirectWriteFns.length} indirect)` : '';
        const range = new vscode.Range(s.line!, 0, s.line!, 0);
        const tooltip = s.exposedAs
          ? `${s.property} exposed via ${s.exposedAs}`
          : `${s.property}: no public exposure detected`;

        // One lens carries one command, so writes and readers used to share a
        // single click that always opened the peek list. They are two lenses
        // now, side by side, and a lone site opens straight at it instead of
        // asking to pick from a list of one.
        const lensFor = (title: string, sites: { line: number; character: number }[]): vscode.CodeLens => {
          if (sites.length === 0) {
            // No write at all: nothing to open, and the title still shows.
            return new vscode.CodeLens(range, {
              title, command: 'editor.action.showReferences',
              arguments: [uri, new vscode.Position(s.line!, 0), [] as vscode.Location[]], tooltip,
            });
          }
          if (sites.length === 1) {
            const at = new vscode.Position(sites[0].line, sites[0].character);
            return new vscode.CodeLens(range, {
              title,
              command: 'vscode.open',
              arguments: [uri, { selection: new vscode.Range(at, at) }],
              tooltip: `${tooltip} · go to it`,
            });
          }
          return new vscode.CodeLens(range, {
            title,
            command: 'editor.action.showReferences',
            arguments: [
              uri,
              new vscode.Position(s.line!, 0),
              sites.map(p => new vscode.Location(uri, new vscode.Position(p.line, p.character))),
            ],
            tooltip,
          });
        };

        // Readers are counted in this file only (Compose collectors live in
        // other files): say so rather than show "0 readers" as a fact.
        const ecrits = `✎ ${s.directWrites} write${s.directWrites !== 1 ? 's' : ''}${indirect}`;
        const lus = `👁 ${readerSites.length} reader${readerSites.length !== 1 ? 's' : ''} in this file`;
        // A second lens only when it has somewhere to go. A lens whose command
        // is the empty string is not reliably rendered (the drawable preview
        // lens vanished that way), and "0 readers in this file" is the very
        // thing worth reading, so it rides along with the writes instead.
        if (readerSites.length === 0) {
          return [lensFor(`${ecrits} · ${lus}`, writeSites)];
        }
        return [lensFor(ecrits, writeSites), lensFor(lus, readerSites)];
      });
  }
}
