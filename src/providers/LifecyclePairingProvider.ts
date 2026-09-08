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
  { open: 'requestLocationUpdates', closes: ['removeUpdates', 'removeLocationUpdates'] },
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
  /** Lifecycle method holding the acquisition (`onStart`). */
  open: string;
  /** The acquiring call (`acquire`, `registerReceiver`): what the release pairs with. */
  method: string;
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
  /** Index of the innermost class/object holding the function, -1 at top level. */
  classId: number;
}

/** Spans of every class/object/interface body, for grouping functions. */
function classSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /\b(?:class|object|interface)\s+\w+[^{;\n]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { out.push({ start: m.index, end: i }); break; } }
    }
  }
  return out;
}

function extractFunctions(text: string): FunSpan[] {
  const spans: FunSpan[] = [];
  const classes = classSpans(text);
  const re = /\bfun\s+(\w+)\s*\(([^)]*)\)[^{=\n]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // `onStop(owner: LifecycleOwner)` is a DefaultLifecycleObserver callback,
    // not the Activity's mirror: it stole the release and made a false orphan.
    if (/LifecycleOwner/.test(m[2])) continue;
    const open = m.index + m[0].length - 1;
    let classId = -1, best = Infinity;
    for (let c = 0; c < classes.length; c++) {
      const span = classes[c];
      if (m.index > span.start && m.index < span.end && span.end - span.start < best) { classId = c; best = span.end - span.start; }
    }
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
            classId,
          });
          break;
        }
      }
    }
  }
  return spans;
}

const IDENT_RE = /^[A-Za-z_]\w*$/;
const NOT_A_RESOURCE = new Set(['this', 'object', 'null', 'true', 'false', 'it']);
/** Receivers whose observers detach themselves: `lifecycle.addObserver(x)`. */
const SELF_DETACHING_RECEIVER = /(?:^|\.)lifecycle$/;

/** Calls of one half of a pair: optional receiver plus the identifying
 *  argument (the 1st by default; bindService is identified by the 2nd). */
function findHalfCalls(
  body: string,
  method: string,
  argIndex = 0,
): { resource: string; candidates: string[]; offsetLines: number }[] {
  const out: { resource: string; candidates: string[]; offsetLines: number }[] = [];
  // `this.resource` as an argument means `resource` (otherwise false orphan).
  const ARG = `(?:this\\s*\\.\\s*)?([\\w.]+)?`;
  const re = new RegExp(
    // `disposable?.dispose()` and `d!!.dispose()` release the same receiver.
    // `(?<![\\w.])`: `bus.unsubscribe(h)` is not a `subscribe(`.
    `(?:([\\w.]+)\\s*(?:\\?\\.|!!\\.|\\.)\\s*|(?<![\\w.]))${method}\\s*\\(\\s*${ARG}(?:\\s*,\\s*${ARG})?(?:\\s*,\\s*${ARG})?(?:\\s*,\\s*${ARG})?`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const receiver = m[1];
    // `FragmentDetailBinding.bind(view)` is ViewBinding, released by
    // `_binding = null`; `lifecycle.addObserver(x)` detaches itself;
    // `onBackPressedDispatcher.addCallback(viewLifecycleOwner) { }` too.
    if (method === 'bind' && receiver && /Binding$|DataBindingUtil$/.test(receiver)) continue;
    if (method === 'addObserver' && receiver && SELF_DETACHING_RECEIVER.test(receiver)) continue;
    if (method === 'addCallback' && /^(?:this|viewLifecycleOwner|owner|activity|requireActivity\(\))$/.test(m[2] ?? '')) continue;
    const rawArgs = [m[2], m[3], m[4], m[5]].map(a => a?.replace(/^this\s*\.\s*/, ''));
    // Only an identifier can be released later: `acquire(10 * 60 * 1000L)`
    // and `registerReceiver(this, receiver, filter)` used to yield `10` and
    // `this` as the resource, and a quick fix that did not compile.
    const usable = (a: string | undefined) => a !== undefined && IDENT_RE.test(a) && !NOT_A_RESOURCE.has(a);
    let resource: string | undefined;
    if (method === 'acquire' || method === 'release') resource = receiver?.split('.').pop();
    else if (usable(rawArgs[argIndex])) resource = rawArgs[argIndex];
    else resource = rawArgs.find(usable) ?? (receiver?.split('.').pop());
    // `disposable = observable.subscribe(::render)`: what gets released is the
    // Disposable assigned, not the observable; the receiver made a false orphan.
    if (method === 'subscribe') {
      const assigned = /(\w+)(?:\s*:\s*[\w<>?.]+)?\s*=\s*$/.exec(body.slice(Math.max(0, m.index - 80), m.index));
      if (assigned) resource = assigned[1];
      else if (/\.(?:add|plusAssign)\s*\(\s*$/.test(body.slice(Math.max(0, m.index - 40), m.index)) || /\+=\s*$/.test(body.slice(Math.max(0, m.index - 20), m.index))) continue; // owned by a CompositeDisposable
    }
    if (!resource) continue;
    // `fusedClient.requestLocationUpdates(request, callback, looper)` is
    // released by `removeLocationUpdates(callback)`: any identifier argument
    // may be the one the mirror names.
    const candidates = [resource, ...rawArgs.filter(usable) as string[]];
    if (receiver) candidates.push(receiver.split('.').pop()!);
    out.push({
      resource,
      candidates: [...new Set(candidates)],
      offsetLines: (body.slice(0, m.index).match(/\n/g) ?? []).length,
    });
  }
  return out;
}

export function analyzeLifecyclePairs(text: string): LifecycleAnalysis {
  const fns = extractFunctions(text);
  // Functions are matched within their own class: an inner observer's
  // `onStop` or a second class in the file used to be taken for the mirror.
  const key = (classId: number, name: string) => `${classId}:${name}`;
  const byName = new Map(fns.map(f => [key(f.classId, f.name), f]));
  const complete: CompletePair[] = [];
  const orphans: OrphanPair[] = [];

  const closesIn = (fn: FunSpan | undefined, closeMethod: string, resources: readonly string[]): boolean => {
    if (!fn) return false;
    const releases = (body: string) => findHalfCalls(body, closeMethod).some(c => resources.includes(c.resource) || c.candidates.some(x => resources.includes(x)));
    if (releases(fn.body)) return true;
    // 1 level of indirection: helpers called from the mirror.
    const calledHelpers = [...fn.body.matchAll(/(?<![\w.])(\w+)\s*\(/g)]
      .map(c => c[1])
      .filter(name => byName.has(key(fn.classId, name)) && name !== fn.name);
    return calledHelpers.some(h => releases(byName.get(key(fn.classId, h))!.body));
  };

  for (const openFn of fns) {
    const mirror = MIRRORS[openFn.name];
    if (!mirror) continue;
    const lifecycle = openFn.name;

    for (const pair of PAIRS) {
      for (const call of findHalfCalls(openFn.body, pair.open, pair.argIndex ?? 0)) {
        const closed = pair.closes.some(c => closesIn(byName.get(key(openFn.classId, mirror)), c, call.candidates));
        if (closed) {
          complete.push({ open: lifecycle, close: mirror, resource: call.resource });
        } else {
          orphans.push({
            open: lifecycle,
            method: pair.open,
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
