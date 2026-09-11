import * as vscode from 'vscode';

/**
 * Keeping an incremental decoration cache aligned with the document.
 *
 * Providers that rescan only the lines a keystroke touched keep two things per
 * line: the decorations to paint, and the multi-line oracles (inside a raw
 * string, inside a block comment) that decide what a line means. An Enter or a
 * Backspace renumbers every line below the caret, so both have to move with it.
 *
 * The decoration cache is keyed by line, but what VS Code actually paints is
 * the `Range` inside each option. Re-keying the map alone leaves the paint one
 * line off.
 */

/**
 * The same options, drawn on another line, or the very same array when they
 * already sit there.
 *
 * Called at paint time rather than on every keystroke: a line shift only
 * renumbers the cache keys, and fast typing coalesces many of those into a
 * single repaint, so the Range objects are rebuilt once instead of once per
 * character.
 */
export function moveDecorationsToLine(
  decos: vscode.DecorationOptions[], line: number,
): vscode.DecorationOptions[] {
  if (decos.length === 0 || decos[0].range.start.line === line) return decos;
  return decos.map(d => ({
    ...d,
    range: new vscode.Range(line, d.range.start.character, line, d.range.end.character),
  }));
}

/**
 * Moves a per-line state the way the decorations move.
 *
 * Lines born from the keystroke inherit the line that was split: a caller only
 * reaches this after proving no multi-line boundary moved, so nothing can
 * change scope between them.
 */
export function shiftLineState(state: boolean[], fromLine: number, delta: number): boolean[] {
  if (state.length === 0 || delta === 0) return state;
  // The two shapes a keystroke actually produces, spliced in place: a rebuilt
  // array per character typed is the kind of cost this provider exists to
  // avoid.
  if (delta === 1)  { state.splice(fromLine, 0, state[fromLine - 1] ?? false); return state; }
  if (delta === -1) { state.splice(fromLine, 1); return state; }
  const lines = Math.max(0, state.length + delta);
  const next: boolean[] = new Array(lines).fill(false);
  for (let i = 0; i < state.length; i++) {
    if (i < fromLine) { if (i < lines) next[i] = state[i]; continue; }
    const target = i + delta;
    if (target >= fromLine && target < lines) next[target] = state[i];
  }
  const inherited = state[fromLine - 1] ?? false;
  for (let i = fromLine; i < fromLine + delta && i < lines; i++) next[i] = inherited;
  return next;
}
