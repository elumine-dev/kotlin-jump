import * as vscode from 'vscode';
import { DeadIsland, deleteTitleFor, messageFor } from './deadIslands';

/**
 * KJ-046 VS Code shell.
 *
 * An island is a cross-file claim squared: every member's death depends on
 * every other member's extents. Editing ANY file of an island voids the whole
 * island, not just that file's findings. And the fix is island-atomic — one
 * WorkspaceEdit through the Refactor Preview, outer extents winning over the
 * nested ones (a member deleted while its dead class's shell stays leaves
 * orphan references — found by a red audit build).
 *
 * Removal positions are precomputed from the SCANNED texts at setFindings
 * time: no fs access (the shell is web-reachable), and the forget-on-edit
 * contract keeps them exact.
 */

export * from './deadIslands';

const CONFIG_KEY = 'deadIslands';

interface PlacedEdit { path: string; range: vscode.Range; }

interface PlacedIsland {
  island: DeadIsland;
  /** Outermost removal extents, as positions in the scanned text. */
  edits: PlacedEdit[];
}

export class DeadIslandProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-dead-islands');
  private placed: PlacedIsland[] = [];
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  /** `texts` are the scanned sources, keyed by path — the offsets' referential. */
  setFindings(islands: readonly DeadIsland[], texts: ReadonlyMap<string, string>): void {
    this.placed = islands.map(island => {
      const byPath = new Map<string, { start: number; end: number }[]>();
      for (const m of island.members) {
        if (m.removeStart < 0) continue;
        (byPath.get(m.path) ?? byPath.set(m.path, []).get(m.path)!).push({ start: m.removeStart, end: m.removeEnd });
      }
      const edits: PlacedEdit[] = [];
      for (const [p, spans] of byPath) {
        const text = texts.get(p);
        if (text === undefined) continue;
        // Outer extents win: deleting a member but keeping its dead class's
        // shell leaves orphan references.
        const outermost = spans.filter(e =>
          !spans.some(o => o !== e && o.start <= e.start && o.end >= e.end
            && (o.start < e.start || o.end > e.end)));
        for (const e of outermost) {
          edits.push({ path: p, range: new vscode.Range(posAt(text, e.start), posAt(text, e.end)) });
        }
      }
      return { island, edits };
    });
    this.publish();
  }

  clear(): void {
    this.placed = [];
    this.collection.clear();
  }

  private publish(): void {
    this.collection.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const { island } of this.placed) {
      for (const m of island.members) {
        const range = new vscode.Range(m.line, m.character, m.line, m.character + m.name.length);
        const chain = m.keptAliveBy.length > 0
          ? ` — '${m.name}' kept alive only by ${m.keptAliveBy.join(', ')}, themselves dead`
          : '';
        const d = new vscode.Diagnostic(range, `${messageFor(island)}${chain}`,
          island.verdict === 'unreferenced'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information);
        if (island.verdict === 'unreferenced') d.tags = [vscode.DiagnosticTag.Unnecessary];
        d.source = 'kotlin-jump';
        d.code = island.verdict === 'unreferenced' ? 'dead-island' : 'testOnly-island';
        const diags = byFile.get(m.path) ?? [];
        diags.push(d);
        byFile.set(m.path, diags);
      }
    }
    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!DeadIslandProvider.isEnabled()) return [];
    const hit = this.placed.find(({ island }) =>
      island.members.some(m => m.path === document.uri.fsPath && m.line === range.start.line));
    if (!hit) return [];
    const member = hit.island.members.find(m => m.path === document.uri.fsPath && m.line === range.start.line)!;
    // Re-verify against the CURRENT text before offering any edit.
    if (!document.lineAt(member.line).text.includes(member.name)) return [];

    // A testOnly island is still exercised, and a fixless island cannot be
    // deleted partially (I5): both stay report-only.
    if (hit.island.verdict !== 'unreferenced' || !hit.island.fixable) return [];

    const action = new vscode.CodeAction(deleteTitleFor(hit.island), vscode.CodeActionKind.QuickFix);
    const edit = new vscode.WorkspaceEdit();
    for (const e of hit.edits) {
      edit.delete(vscode.Uri.file(e.path), e.range,
        { needsConfirmation: true, label: deleteTitleFor(hit.island) });
    }
    for (const imp of hit.island.staleImports) {
      edit.delete(vscode.Uri.file(imp.path), new vscode.Range(imp.line, 0, imp.line + 1, 0),
        { needsConfirmation: true, label: `Remove stale import of ${imp.name}` });
    }
    action.edit = edit;
    return [action];
  }

  private forget(path: string): void {
    const before = this.placed.length;
    this.placed = this.placed.filter(({ island }) =>
      !island.members.some(m => m.path === path) && !island.staleImports.some(s => s.path === path));
    if (this.placed.length !== before) this.publish();
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}

function posAt(text: string, offset: number): vscode.Position {
  const head = text.slice(0, offset);
  const line = (head.match(/\n/g) ?? []).length;
  return new vscode.Position(line, offset - (head.lastIndexOf('\n') + 1));
}
