import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';

// Matches lowercase-starting call expressions: fetchUser(, loadPosts(, delay(
const CALL_RE = /\b([a-z][A-Za-z0-9_]*)\s*\(/g;

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

      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(text)) !== null) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const entries = this.index.lookup(m[1]);
        if (!entries.some(e => e.isSuspend)) continue;
        const hint = new vscode.InlayHint(
          new vscode.Position(ln, m.index),
          '⚡',
          vscode.InlayHintKind.Parameter,
        );
        hint.paddingRight = true;
        hints.push(hint);
      }
    }
    return hints;
  }
}
