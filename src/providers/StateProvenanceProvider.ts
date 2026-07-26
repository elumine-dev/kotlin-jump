import * as vscode from 'vscode';

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
const DECL_RE =
  /(?:^|[{;])\s*(?:private\s+|internal\s+|protected\s+)*va[lr]\s+(\w+)(?:\s*:\s*[^=]+?)?\s*=\s*(MutableStateFlow|MutableLiveData|MutableSharedFlow|mutableStateOf)\s*[(<]/;

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

function countDirectWrites(property: string, text: string): number {
  // value = / += / -= / *= / /=, but not ==
  const re = new RegExp(
    `\\b${property}\\.(value\\s*[+\\-*/]?=[^=]|update\\s*[({]|postValue\\s*\\(|setValue\\s*\\(|emit\\s*\\(|tryEmit\\s*\\()`,
    'g',
  );
  return (text.match(re) ?? []).length;
}

export function analyzeStateProvenance(vmText: string): StateProvenance[] {
  const lines = vmText.split('\n');
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
      const expo = expoRe.exec(vmText);
      if (expo) exposedAs = expo[1];
    }

    results.push({
      property,
      ...(exposedAs !== undefined ? { exposedAs } : {}),
      directWrites: countDirectWrites(property, vmText),
      indirectWriteFns: [],
      kind,
      line: i,
    });
  }

  // Indirect writes: F calls G, G writes P directly, F does not.
  const fns = extractFunctions(vmText);
  for (const state of results) {
    const directWriters = fns.filter(f => countDirectWrites(state.property, f.body) > 0);
    for (const f of fns) {
      if (directWriters.some(d => d.name === f.name)) continue;
      const callsWriter = directWriters.some(d =>
        new RegExp(`\\b${d.name}\\s*\\(`).test(f.body.slice(f.body.indexOf('{') + 1)),
      );
      if (callsWriter) state.indirectWriteFns.push(f.name);
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
  const re = new RegExp(
    `\\b${property}\\.(value\\s*[+\\-*/]?=[^=]|update\\s*[({]|postValue\\s*\\(|setValue\\s*\\(|emit\\s*\\(|tryEmit\\s*\\()`,
    'g',
  );
  return collectMatches(fileText, re);
}

function collectMatches(text: string, re: RegExp): SitePosition[] {
  const out: SitePosition[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const line = (before.match(/\n/g) ?? []).length;
    out.push({ line, character: m.index - (before.lastIndexOf('\n') + 1) });
  }
  return out;
}

export class StateProvenanceProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('stateProvenance', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    if (!/Mutable(StateFlow|LiveData|SharedFlow)|mutableStateOf/.test(text)) return [];

    return analyzeStateProvenance(text)
      .filter(s => s.line !== undefined)
      .map(s => {
        const readerName = s.exposedAs ?? s.property;
        const writeSites = collectWriteSites(s.property, text);
        const readerSites = collectReaderSites(readerName, text);
        const indirect = s.indirectWriteFns.length > 0 ? ` (+${s.indirectWriteFns.length} indirect)` : '';
        const title = `✎ ${s.directWrites} write${s.directWrites > 1 ? 's' : ''}${indirect} · 👁 ${readerSites.length} reader${readerSites.length > 1 ? 's' : ''}`;

        // Click = native reference peek: writes first, then reads.
        const locations = [...writeSites, ...readerSites].map(
          p => new vscode.Location(document.uri, new vscode.Position(p.line, p.character)),
        );
        return new vscode.CodeLens(new vscode.Range(s.line!, 0, s.line!, 0), {
          title,
          command: locations.length > 0 ? 'editor.action.showReferences' : '',
          arguments:
            locations.length > 0
              ? [document.uri, new vscode.Position(s.line!, 0), locations]
              : undefined,
          tooltip: s.exposedAs
            ? `${s.property} exposed via ${s.exposedAs}. Click to see writes and readers.`
            : `${s.property}: no public exposure detected`,
        });
      });
  }
}
