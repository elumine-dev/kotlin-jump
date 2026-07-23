import * as vscode from 'vscode';
import { countTripleQuotes } from '../util/textUtils';

// Pipeline operators worth numbering: Flow, Sequence, and collection
// transforms. Scope functions (let/also/apply/run) and builders are
// deliberately absent — they are not data pipeline stages.
const CHAIN_OPERATORS = new Set([
  // transforms
  'map', 'mapNotNull', 'mapLatest', 'flatMap', 'flatMapLatest', 'flatMapConcat',
  'flatMapMerge', 'transform', 'scan', 'runningFold', 'fold', 'reduce', 'zip',
  'combine', 'withIndex',
  // filters
  'filter', 'filterNot', 'filterNotNull', 'filterIsInstance', 'distinct',
  'distinctBy', 'distinctUntilChanged', 'take', 'takeWhile', 'drop', 'dropWhile',
  'debounce', 'sample', 'conflate', 'buffer',
  // side effects and lifecycle
  'onEach', 'onStart', 'onCompletion', 'onEmpty', 'catch', 'retry', 'retryWhen',
  'flowOn', 'launchIn', 'shareIn', 'stateIn',
  // ordering and grouping
  'sorted', 'sortedBy', 'sortedByDescending', 'groupBy', 'chunked', 'windowed',
  // terminals
  'collect', 'collectLatest', 'toList', 'toSet', 'toMap', 'first', 'firstOrNull',
  'last', 'lastOrNull', 'single', 'singleOrNull', 'count', 'sum', 'sumOf',
  'joinToString', 'forEach', 'associate', 'associateBy', 'associateWith',
]);

// `.operator(` or `.operator {` at the start of a line (chain continuation).
const CHAIN_LINE_RE = /^(\s*)\.([a-zA-Z_]\w*)\s*[({]/;

// ① .. ⑳ then plain (n) beyond Unicode's circled range.
function badge(n: number): string {
  return n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
}

interface ChainStep { line: number; column: number }

/**
 * Numbers the stages of a multi-line Flow / collection pipeline:
 *
 *   flow
 *       ① .map { it.name }
 *       ② .filter { it != "" }
 *       ③ .collect { render(it) }
 *
 * Chains of one operator get no badge; the whole point is making longer
 * pipelines scannable. Line-start detection only: a single-line
 * `list.map{}.filter{}` is already scannable and stays untouched.
 * Toggle with `kotlinJump.flowChainBadges`.
 */
export class FlowChainProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onChange.event;

  fireChange(): void { this._onChange.fire(); }
  dispose(): void { this._onChange.dispose(); }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('flowChainBadges', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const hints: vscode.InlayHint[] = [];
    let chain: ChainStep[] = [];
    let depth = 0;        // brace/paren depth inside the current chain
    let inRaw = false;    // inside a """ raw string

    const flush = () => {
      if (chain.length >= 2) {
        for (let i = 0; i < chain.length; i++) {
          const h = new vscode.InlayHint(
            new vscode.Position(chain[i].line, chain[i].column),
            badge(i + 1),
            vscode.InlayHintKind.Parameter,
          );
          h.paddingRight = true;
          hints.push(h);
        }
      }
      chain = [];
      depth = 0;
    };

    // Chains and raw strings can open above the requested range, so state
    // is tracked from the top of the file; hints outside the range are
    // still emitted (VS Code drops them) to keep numbering consistent.
    for (let ln = 0; ln < document.lineCount; ln++) {
      const text = document.lineAt(ln).text;

      const delta = inRaw ? 0 : braceDelta(text);
      if (countTripleQuotes(text) % 2 !== 0) inRaw = !inRaw;

      if (chain.length === 0) { continueScan(text, ln); continue; }

      if (depth > 0 || inRaw) {
        // Inside a lambda body (or raw string) belonging to the chain.
        depth += delta;
        if (depth < 0) flush();   // over-closed: chain expression ended
        continue;
      }

      const m = CHAIN_LINE_RE.exec(text);
      if (m && CHAIN_OPERATORS.has(m[2])) {
        chain.push({ line: ln, column: m[1].length });
        depth += delta;
        continue;
      }
      if (/^\s*(\/\/|$)/.test(text)) continue;  // comments and blanks are neutral
      flush();
      continueScan(text, ln);
    }
    flush();
    return hints;

    // Starts a new chain when a line opens with a known operator. The
    // receiver line above it deliberately gets no badge.
    function continueScan(text: string, ln: number): void {
      const m = CHAIN_LINE_RE.exec(text);
      if (m && CHAIN_OPERATORS.has(m[2])) {
        chain = [{ line: ln, column: m[1].length }];
        depth = braceDelta(text);
      }
    }
  }
}

/**
 * Net brace/paren depth change of one line, ignoring braces inside line
 * comments, string literals, and char literals. Raw string interiors are
 * handled by the caller (delta forced to 0 while inside `"""`).
 */
function braceDelta(line: string): number {
  let delta = 0;
  let inStr: string | false = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = false;
      continue;
    }
    if (ch === '"' || ch === '\'') { inStr = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '{' || ch === '(') delta++;
    else if (ch === '}' || ch === ')') delta--;
  }
  return delta;
}
