import * as vscode from 'vscode';

/**
 * KJ-016: Lifecycle Pairing, detects acquisitions made in a lifecycle method
 * with no release in the mirror method (registerReceiver without
 * unregisterReceiver, acquire without release…).
 * The release can go through a helper called from the mirror (1 level).
 */

// An acquisition can have SEVERAL valid releases (subscribe → dispose OR
// unsubscribe): a single one is enough to complete the pair.
// argIndex: 0-based position of the argument identifying the resource.
// bindService(intent, CONNECTION, flags) is identified by its connection.
const PAIRS: { open: string; closes: string[]; argIndex?: number }[] = [
  { open: 'registerReceiver', closes: ['unregisterReceiver'] },
  { open: 'requestLocationUpdates', closes: ['removeUpdates'] },
  { open: 'addListener', closes: ['removeListener'] },
  { open: 'addObserver', closes: ['removeObserver'] },
  { open: 'addCallback', closes: ['removeCallback'] },
  { open: 'acquire', closes: ['release'] },
  { open: 'subscribe', closes: ['dispose', 'unsubscribe'] },
  { open: 'bindService', closes: ['unbindService'], argIndex: 1 },
  { open: 'bind', closes: ['unbind'] },
];

/** First known release call for an acquisition, for the quick fix. */
export function closeFor(open: string): string | undefined {
  return PAIRS.find(p => p.open === open)?.closes[0];
}

const MIRRORS: Record<string, string> = {
  onCreate: 'onDestroy',
  onStart: 'onStop',
  onResume: 'onPause',
  onViewCreated: 'onDestroyView',
};

export interface CompletePair {
  open: string;
  close: string;
  resource: string;
}

export interface OrphanPair {
  open: string;
  expectedIn: string;
  resource: string;
  /** 0-based line of the acquisition call. */
  line: number;
}

export interface LifecycleAnalysis {
  complete: CompletePair[];
  orphans: OrphanPair[];
}

interface FunSpan {
  name: string;
  body: string;
  startLine: number;
}

function extractFunctions(text: string): FunSpan[] {
  const spans: FunSpan[] = [];
  const re = /\bfun\s+(\w+)\s*\([^)]*\)[^{=\n]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          spans.push({
            name: m[1],
            body: text.slice(open, i + 1),
            startLine: (text.slice(0, m.index).match(/\n/g) ?? []).length,
          });
          break;
        }
      }
    }
  }
  return spans;
}

/** Calls of one half of a pair: optional receiver plus the identifying
 *  argument (the 1st by default; bindService is identified by the 2nd). */
function findHalfCalls(
  body: string,
  method: string,
  argIndex = 0,
): { resource: string; offsetLines: number }[] {
  const out: { resource: string; offsetLines: number }[] = [];
  // `this.resource` as an argument means `resource` (otherwise false orphan).
  const ARG = `(?:this\\s*\\.\\s*)?(\\w+)?`;
  const re = new RegExp(
    `(?:(\\w+)\\.)?${method}\\s*\\(\\s*${ARG}(?:\\s*,\\s*${ARG})?`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const args = [m[2], m[3]];
    const resource = args[argIndex] ?? args[0] ?? m[1];
    if (!resource) continue;
    out.push({
      resource,
      offsetLines: (body.slice(0, m.index).match(/\n/g) ?? []).length,
    });
  }
  return out;
}

export function analyzeLifecyclePairs(text: string): LifecycleAnalysis {
  const fns = extractFunctions(text);
  const byName = new Map(fns.map(f => [f.name, f]));
  const complete: CompletePair[] = [];
  const orphans: OrphanPair[] = [];

  const closesIn = (fn: FunSpan | undefined, closeMethod: string, resource: string): boolean => {
    if (!fn) return false;
    if (findHalfCalls(fn.body, closeMethod).some(c => c.resource === resource)) return true;
    // 1 level of indirection: helpers called from the mirror.
    const calledHelpers = [...fn.body.matchAll(/(?<![\w.])(\w+)\s*\(/g)]
      .map(c => c[1])
      .filter(name => byName.has(name) && name !== fn.name);
    return calledHelpers.some(h =>
      findHalfCalls(byName.get(h)!.body, closeMethod).some(c => c.resource === resource),
    );
  };

  for (const [lifecycle, mirror] of Object.entries(MIRRORS)) {
    const openFn = byName.get(lifecycle);
    if (!openFn) continue;

    for (const pair of PAIRS) {
      for (const call of findHalfCalls(openFn.body, pair.open, pair.argIndex ?? 0)) {
        const closed = pair.closes.some(c => closesIn(byName.get(mirror), c, call.resource));
        if (closed) {
          complete.push({ open: lifecycle, close: mirror, resource: call.resource });
        } else {
          orphans.push({
            open: lifecycle,
            expectedIn: mirror,
            resource: call.resource,
            line: openFn.startLine + call.offsetLines,
          });
        }
      }
    }
  }
  return { complete, orphans };
}

export class LifecyclePairingProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-lifecycle');
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._subs = [
      vscode.workspace.onDidOpenTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => this._diag.delete(doc.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.lifecyclePairing')) {
          for (const d of vscode.workspace.textDocuments) this._scan(d);
        }
      }),
    ];
    for (const doc of vscode.workspace.textDocuments) this._scan(doc);
  }

  private _scan(doc: vscode.TextDocument): void {
    if (doc.languageId !== 'kotlin' && doc.languageId !== 'java') return;
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('lifecyclePairing', true);
    if (!enabled) {
      this._diag.delete(doc.uri);
      return;
    }

    const text = doc.getText();
    if (!/\boverride\s+fun\s+on(Start|Resume|Create|ViewCreated)\b/.test(text)) {
      this._diag.delete(doc.uri);
      return;
    }

    const { orphans } = analyzeLifecyclePairs(text);
    this._diag.set(
      doc.uri,
      orphans.map(o => {
        const lineText = doc.lineAt(o.line).text;
        const d = new vscode.Diagnostic(
          new vscode.Range(o.line, lineText.length - lineText.trimStart().length, o.line, lineText.length),
          `${o.resource} acquired in ${o.open}() with no release in ${o.expectedIn}()`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'kotlin-jump';
        d.code = 'lifecycle-pairing';
        return d;
      }),
    );
  }

  dispose(): void {
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
