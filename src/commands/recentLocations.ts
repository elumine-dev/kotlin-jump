import * as vscode from 'vscode';
import { NavigationHistoryProvider } from '../providers/NavigationHistoryProvider';

/**
 * KJ-008 — Recent locations popup (IntelliJ Cmd+Shift+E) : QuickPick of the
 * last visited locations with a code excerpt, Enter = jump.
 */

export interface RecentLocationEntry {
  file: string;
  line: number;
  timestamp: number;
}

export interface RecentLocationItem {
  label: string;
  description: string;
  detail: string;
}

const DEDUP_LINE_DISTANCE = 2;

/** Reverse chronological sort + dedup of neighbouring visits (±2 lines). */
function dedupRecent(entries: RecentLocationEntry[]): RecentLocationEntry[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const kept: RecentLocationEntry[] = [];
  for (const e of sorted) {
    const isNeighbor = kept.some(
      k => k.file === e.file && Math.abs(k.line - e.line) <= DEDUP_LINE_DISTANCE,
    );
    if (!isNeighbor) kept.push(e);
  }
  return kept;
}

function shortName(file: string): string {
  const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return idx >= 0 ? file.slice(idx + 1) : file;
}

/** QuickPick items, most recent first, code excerpt in the detail field. */
export function buildRecentLocationItems(
  entries: RecentLocationEntry[],
  excerptOf: (file: string, line: number) => string,
): RecentLocationItem[] {
  // 1-based display: the internal line is 0-based but a human reads ":8" for
  // the 8th line, like everywhere else in the editor.
  return dedupRecent(entries).map(e => ({
    label: `${shortName(e.file)}:${e.line + 1}`,
    description: e.file,
    detail: excerptOf(e.file, e.line),
  }));
}

export async function recentLocationsCommand(history: NavigationHistoryProvider): Promise<void> {
  const entries = history.recentLocations();
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Kotlin Jump: no recent locations yet.');
    return;
  }

  // Preload the text of the documents involved, for the excerpts.
  const docs = new Map<string, string[]>();
  for (const file of new Set(entries.map(x => x.file))) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
      docs.set(file, doc.getText().split('\n'));
    } catch {
      // file gone: entry still listed, without an excerpt
    }
  }
  const excerptOf = (file: string, line: number): string => {
    const lines = docs.get(file);
    if (!lines) return '';
    const from = Math.max(0, line - 1);
    const to = Math.min(lines.length - 1, line + 1);
    return lines.slice(from, to + 1).map(l => l.trim()).join(' ⏎ ');
  };

  const kept = dedupRecent(entries);
  const pick = await vscode.window.showQuickPick(
    kept.map(e => ({
      label: `${shortName(e.file)}:${e.line + 1}`,
      detail: excerptOf(e.file, e.line),
      entry: e,
    })),
    { placeHolder: 'Recent locations', matchOnDetail: true },
  );
  if (!pick) return;

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(pick.entry.file));
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(Math.min(pick.entry.line, doc.lineCount - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
