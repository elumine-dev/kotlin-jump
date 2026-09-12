import * as vscode from 'vscode';
import { estLeFichier } from '../util/measuredText';
import { corpusUri } from '../util/corpusUri';
import { addCascadePlan, planCascade } from './applyCascade';
import { insertImport } from './AutoImportProvider';
import { parse } from '../indexer/KotlinParser';
import {
  UnusedSymbol,
  deleteTitleFor,
  messageFor,
  wholeLineExtent,
  currentRemovalExtent,
} from './unusedSymbols';

/**
 * KJ-032 VS Code shell: diagnostics and the removal quick fix.
 *
 * The detector lives in `unusedSymbols.ts` so it can run without an extension
 * host; everything it exports is re-exported here because the rest of the
 * codebase reaches for this file by name.
 */

export * from './unusedSymbols';

const CONFIG_KEY = 'unusedSymbols';

export class UnusedSymbolProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-symbols');
  private readonly byPath = new Map<string, UnusedSymbol[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      // A cross-file claim cannot be recomputed from one buffer, so an edited
      // file loses its findings until the next scan. A stale "this is dead"
      // claim is the dangerous kind.
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  setFindings(findings: readonly UnusedSymbol[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const list = this.byPath.get(f.path) ?? [];
      list.push(f);
      this.byPath.set(f.path, list);

      const range = new vscode.Range(f.line, f.character, f.line, f.character + f.name.length);
      const d = new vscode.Diagnostic(range, messageFor(f), f.verdict === 'unreferenced'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information);
      // Test-only code is NOT unnecessary: the tag strikes it through, and the
      // tests do exercise it. Only a truly unreferenced symbol gets the tag.
      if (f.verdict === 'unreferenced') d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = f.verdict === 'unreferenced' ? 'unused-symbol' : 'test-only-symbol';
      const diags = byFile.get(f.path) ?? [];
      diags.push(d);
      byFile.set(f.path, diags);
    }

    for (const [p, diags] of byFile) this.collection.set(corpusUri(p), diags);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  findingsFor(path: string): UnusedSymbol[] | undefined {
    return this.byPath.get(path);
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    if (!UnusedSymbolProvider.isEnabled()) return [];
    const findings = this.byPath.get(document.uri.fsPath);
    if (!findings?.length) return [];

    // Resolve the declaration under the cursor against the CURRENT text, so a
    // stale offset from the last scan can never aim the fix at the wrong line.
    const parsed = parse(document.uri.fsPath, document.getText());
    const here = parsed.symbols.find(s =>
      s.depth === 0 && s.line === range.start.line);
    if (!here) return [];

    // Two overloads share a name, so the first finding is not necessarily the
    // one under the cursor: the fix offered on the second `fun load` deleted
    // the first. The scan's line may lag an edit, hence nearest rather than
    // exact, the same rule `currentRemovalExtent` follows.
    const hit = findings
      .filter(f => f.name === here.name)
      .reduce<UnusedSymbol | undefined>(
        (best, f) => (best === undefined
          || Math.abs(f.line - here.line) < Math.abs(best.line - here.line)) ? f : best,
        undefined,
      );
    if (!hit) return [];

    const actions: vscode.CodeAction[] = [];

    if (hit.verdict === 'unreferenced' && hit.removeStart !== -1) {
      const title = hit.fileBecomesEmpty
        ? `Delete ${basename(hit.path)} (nothing else in it)`
        : hit.staleImports.length > 0
          ? `${deleteTitleFor(hit)} (and ${hit.staleImports.length} stale import${hit.staleImports.length > 1 ? 's' : ''})`
          : deleteTitleFor(hit);
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.edit = await buildSymbolRemovalEdit([hit], document);
      // Removing a declaration is never the default lightbulb pick.
      action.isPreferred = false;
      actions.push(action);
    }

    if (hit.verdict === 'testOnly') {
      // @VisibleForTesting both documents the reality and silences the warning
      // afterwards, which is why it is not in the benign annotation allowlist.
      const annotate = new vscode.CodeAction(
        `Annotate ${hit.name} with @VisibleForTesting`,
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      const indent = /^[ \t]*/.exec(document.lineAt(hit.line).text)?.[0] ?? '';
      edit.insert(document.uri, new vscode.Position(hit.line, 0), `${indent}@VisibleForTesting\n`);
      // The annotation alone left an unresolved reference until the import was typed by hand.
      if (!/^\s*import\s+androidx\.annotation\.VisibleForTesting\b/m.test(document.getText())) {
        const imp = insertImport(document, 'androidx.annotation.VisibleForTesting');
        edit.insert(document.uri, imp.range.start, imp.newText);
      }
      annotate.edit = edit;
      actions.push(annotate);
    }

    const suppress = new vscode.CodeAction(
      `Suppress with @Suppress("unused")`,
      vscode.CodeActionKind.QuickFix,
    );
    const suppressEdit = new vscode.WorkspaceEdit();
    const indent = /^[ \t]*/.exec(document.lineAt(hit.line).text)?.[0] ?? '';
    suppressEdit.insert(document.uri, new vscode.Position(hit.line, 0), `${indent}@Suppress("unused")\n`);
    suppress.edit = suppressEdit;
    actions.push(suppress);

    return actions;
  }

  private forget(path: string): void {
    this.collection.delete(corpusUri(path));
    this.byPath.delete(path);
  }

  dispose(): void {
    this.collection.dispose();
    for (const s of this.subs) s.dispose();
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/**
 * Builds the removal edit, recomputing every range against the CURRENT text.
 *
 * The offsets in a finding date from the scan. Rather than invent an
 * invalidation protocol, rescan: a declaration that moved or went away is
 * silently skipped. Same discipline as KJ-031's `buildRemovalEdit`.
 */
export async function buildSymbolRemovalEdit(
  findings: readonly UnusedSymbol[],
  openDocument?: vscode.TextDocument,
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit();
  const decoder = new TextDecoder();
  // Memoized, and that is a correctness property before it is a speed one.
  // The range pass and the writing pass both ask for the same file, and a
  // second read between two `await`s can return DIFFERENT text: the offsets
  // computed on the first would then land somewhere else in the second. It
  // also stops a file imported by thirty dead symbols from being read thirty
  // times.
  const cache = new Map<string, string | undefined>();
  const textOf = async (p: string): Promise<string | undefined> => {
    if (cache.has(p)) return cache.get(p);
    const lu = await lire(p);
    cache.set(p, lu);
    return lu;
  };
  const lire = async (p: string): Promise<string | undefined> => {
    if (openDocument && openDocument.uri.fsPath === p) return openDocument.getText();
    try {
      // The corpus computed its offsets on open editors' text (1.42.11); the
      // disk copy of a dirty file would put the deletion lines off again.
      const open = vscode.workspace.textDocuments.find(estLeFichier(p));
      if (open) return open.getText();
      return decoder.decode(await vscode.workspace.fs.readFile(corpusUri(p)));
    } catch {
      return undefined;
    }
  };

  const perFile = new Map<string, UnusedSymbol[]>();
  for (const f of findings) {
    const list = perFile.get(f.path) ?? [];
    list.push(f);
    perFile.set(f.path, list);
  }
  // KJ-048: what the cuts orphan. Filled as the ranges are computed below, so
  // the cascade sees exactly what this edit removes and nothing else.
  const textForCascade = new Map<string, string>();

  // Decided up front: a stale-import edit aimed at a file this same edit
  // deletes made VS Code reject the whole WorkspaceEdit, silently.
  const deleted = new Set<string>();
  for (const [p, group] of perFile) {
    if (group.every(f => f.fileBecomesEmpty) && group[0].fileBecomesEmpty) deleted.add(p);
  }

  // KJ-048 first pass: the ranges, computed but not emitted. The cascade has to
  // answer BEFORE any range edit is written, because a WorkspaceEdit that both
  // deletes a URI and edits a range in it is rejected whole, and in silence.
  const rangesByPath = new Map<string, { start: number; end: number }[]>();
  for (const [p, group] of perFile) {
    if (deleted.has(p)) continue;
    const text = await textOf(p);
    if (text === undefined) continue;
    const ranges = group
      .filter(f => f.removeStart !== -1)
      .map(f => currentRemovalExtent(p, text, f.name, f.kind, f.line))
      .filter((e): e is { removeStart: number; removeEnd: number } => e !== undefined && e.removeStart !== -1)
      .map(e => wholeLineExtent(text, e.removeStart, e.removeEnd))
      .sort((a, b) => a.start - b.start);
    const kept: { start: number; end: number }[] = [];
    let previousEnd = -1;
    for (const r of ranges) {
      if (r.start < previousEnd) continue; // overlapping extents: keep the first
      previousEnd = r.end;
      kept.push({ start: r.start, end: r.end });
    }
    if (kept.length > 0) { rangesByPath.set(p, kept); textForCascade.set(p, text); }
  }
  const cascade = planCascade(rangesByPath, textForCascade, deleted);
  // `deleted` keeps the files THIS loop deletes; `doomed` is every file that
  // must receive no range edit. Merging them would emit two deleteFile ops for
  // the same URI, since `addCascadePlan` writes the cascade's own.
  const doomed = new Set([...deleted, ...cascade.deleteFiles]);

  for (const [p, group] of perFile) {
    const text = await textOf(p);
    if (text === undefined) continue;

    // Never a deleteFile AND range edits on the same URI in one WorkspaceEdit.
    if (doomed.has(p)) {
      // A file the CASCADE deletes gets its deleteFile from addCascadePlan, so
      // writing one here too would put two of them on the same URI. Either way
      // the stale imports below still have to go.
      if (deleted.has(p)) {
        edit.deleteFile(
          corpusUri(p),
          { ignoreIfNotExists: true },
          { needsConfirmation: true, label: `Delete ${basename(p)}` },
        );
      }
    } else {
      const starts = lineStartsOf(text);
      for (const r of rangesByPath.get(p) ?? []) {
        edit.replace(
          corpusUri(p),
          new vscode.Range(posAt(starts, r.start), posAt(starts, r.end)),
          '',
          { needsConfirmation: true, label: `Remove unreferenced declaration` },
        );
      }
    }

    // Imports left dangling in OTHER files are part of the fix, not a nicety:
    // without them the workspace stops compiling the moment the declaration
    // goes away.
    for (const f of group) {
      for (const stale of f.staleImports) {
        if (doomed.has(stale.path)) continue;
        const importText = await textOf(stale.path);
        if (importText === undefined) continue;
        const line = importText.split('\n')[stale.line];
        // Re-verify: an import that moved since the scan is skipped, not guessed.
        if (line === undefined || !new RegExp(`^\\s*import\\s+[\\w.]*\\b${f.name}\\b`).test(line)) continue;
        edit.delete(
          corpusUri(stale.path),
          new vscode.Range(stale.line, 0, stale.line + 1, 0),
          { needsConfirmation: true, label: `Remove stale import of ${f.name}` },
        );
      }
    }
  }

  addCascadePlan(edit, cascade, textForCascade);
  return edit;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts: readonly number[], offset: number): vscode.Position {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return new vscode.Position(low, offset - starts[low]);
}
