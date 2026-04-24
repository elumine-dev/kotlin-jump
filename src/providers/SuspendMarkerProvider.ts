import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';

// Matches lowercase-starting call expressions: fetchUser(, loadPosts(, delay(
const CALL_RE = /\b([a-z][A-Za-z0-9_]*)\s*\(/g;

// Coroutine builders that take a CoroutineContext/dispatcher as first arg
// and where a `Dispatchers.X` marker would be informative. Scoping on
// these names keeps the dispatcher regex from matching random calls.
const DISPATCHER_BUILDERS = new Set([
  'withContext', 'launch', 'async', 'flowOn', 'produce', 'actor',
]);

// Captures the `Dispatchers.X` argument when it is passed directly to a
// builder. Intentionally conservative: `withContext(myCtx)` (variable
// reference) does not light up — only the literal form does. The
// alternative is whole-program dataflow, which is out of scope for a
// regex-based provider.
const DISPATCHER_RE = /\b(withContext|launch|async|flowOn|produce|actor)\s*\(\s*Dispatchers\.(IO|Main|Main\.immediate|Default|Unconfined)\b/g;

const DISPATCHER_BADGE: Record<string, string> = {
  'IO':              '🧵 IO',
  'Main':            '🖥 Main',
  'Main.immediate':  '🖥 Main',
  'Default':         '⚙ Default',
  'Unconfined':      '🔀 Unconfined',
};

export class SuspendMarkerProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onChange.event;

  constructor(private readonly index: SymbolIndex) {}

  fireChange(): void { this._onChange.fire(); }
  dispose(): void { this._onChange.dispose(); }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('suspendCallMarkers', true)) return [];
    const lang = document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') return [];

    const hints: vscode.InlayHint[] = [];
    let inRaw = false;

    for (let ln = range.start.line; ln <= range.end.line; ln++) {
      const text = document.lineAt(ln).text;
      if (countTripleQuotes(text) % 2 !== 0) inRaw = !inRaw;
      if (inRaw) continue;
      if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue;
      // Skip function declaration lines to avoid marking the `suspend fun` declaration
      if (/\bsuspend\s+fun\b/.test(text)) continue;

      // ── Dispatcher badges ────────────────────────────────────────────
      // Emit one badge per builder invocation that directly names a
      // `Dispatchers.X`. These render at the position of the BUILDER
      // identifier (before the `⚡` would land on a suspend call). We
      // track positions where a badge was emitted so the downstream
      // suspend-marker scan can skip those builder names — otherwise
      // `launch` / `async` / `withContext` themselves might get a
      // redundant ⚡ too.
      const badgeAt = new Set<number>();
      DISPATCHER_RE.lastIndex = 0;
      let dm: RegExpExecArray | null;
      while ((dm = DISPATCHER_RE.exec(text)) !== null) {
        if (isInsideCommentOrString(text, dm.index)) continue;
        const builder    = dm[1];
        const dispatcher = dm[2];
        const badge      = DISPATCHER_BADGE[dispatcher];
        if (!badge) continue;
        hints.push(makeHint(ln, dm.index, badge));
        badgeAt.add(dm.index);
        // Explicit skip: the builder name itself would otherwise also
        // match `CALL_RE` below and receive a ⚡ marker.
        if (DISPATCHER_BUILDERS.has(builder)) badgeAt.add(dm.index);
      }

      // ── Suspend call markers (existing behavior) ─────────────────────
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(text)) !== null) {
        if (isInsideCommentOrString(text, m.index)) continue;
        if (badgeAt.has(m.index)) continue; // already has a dispatcher badge
        const entries = this.index.lookup(m[1]);
        if (!entries.some(e => e.isSuspend)) continue;
        hints.push(makeHint(ln, m.index, '⚡'));
      }
    }
    return hints;
  }
}

function makeHint(line: number, col: number, label: string): vscode.InlayHint {
  const hint = new vscode.InlayHint(
    new vscode.Position(line, col),
    label,
    vscode.InlayHintKind.Parameter,
  );
  hint.paddingRight = true;
  return hint;
}
