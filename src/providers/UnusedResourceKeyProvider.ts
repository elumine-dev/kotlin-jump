import * as vscode from 'vscode';
import {
  ValueKeyDeclaration,
  collectValueKeyDeclarations,
} from '../indexer/ValueResourceScanner';
import {
  UnusedResourceKey,
  deleteTitleFor,
  expandToWholeLines,
  messageFor,
} from './unusedResourceKeys';

/**
 * KJ-031 VS Code shell: diagnostics and the removal quick fix.
 *
 * The detector itself lives in `unusedResourceKeys.ts` so it can run without
 * an extension host. Everything it exports is re-exported here, because the
 * rest of the codebase reaches for this file by name.
 */

export * from './unusedResourceKeys';

const CONFIG_KEY = 'unusedResourceKeys';

/**
 * Diagnostics and the removal quick fix.
 *
 * One warning per KEY, on its base declaration, never one per qualifier
 * variant: a translated app with 150 dead strings across 12 locales would
 * otherwise put 1800 warnings in the Problems panel for 150 problems.
 */
export class UnusedResourceKeyProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-resource-keys');
  private readonly byPath = new Map<string, UnusedResourceKey[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      // A stale "this is dead" claim is the dangerous kind, so an edited file
      // loses its findings until the next scan.
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  setFindings(findings: readonly UnusedResourceKey[]): void {
    this.collection.clear();
    this.byPath.clear();

    const diagnosticsByPath = new Map<string, vscode.Diagnostic[]>();
    for (const finding of findings) {
      // Every variant answers the lightbulb, only the base carries the warning.
      for (const variant of finding.variants) {
        const list = this.byPath.get(variant.path) ?? [];
        list.push(finding);
        this.byPath.set(variant.path, list);
      }

      const { base } = finding;
      const d = new vscode.Diagnostic(
        new vscode.Range(base.line, base.character, base.line, base.character + base.nameLength),
        messageFor(finding),
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-resource-key';
      const list = diagnosticsByPath.get(base.path) ?? [];
      list.push(d);
      diagnosticsByPath.set(base.path, list);
    }

    for (const [p, diagnostics] of diagnosticsByPath) {
      this.collection.set(vscode.Uri.file(p), diagnostics);
    }
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  /** True when this provider owns the dead-key story for `res/values*`. */
  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    if (!UnusedResourceKeyProvider.isEnabled()) return [];
    const findings = this.byPath.get(document.uri.fsPath);
    if (!findings?.length) return [];

    // Locate the entry under the cursor in the CURRENT text, so a stale offset
    // from the last scan can never point the lightbulb at the wrong line.
    const offset = document.offsetAt(range.start);
    const here = collectValueKeyDeclarations(document.uri.fsPath, document.getText())
      .find(d => offset >= d.start && offset <= d.end);
    if (!here) return [];

    const hit = findings.find(f => f.kind === here.kind && f.name === here.name);
    if (!hit) return [];

    const action = new vscode.CodeAction(deleteTitleFor(hit), vscode.CodeActionKind.QuickFix);
    action.edit = await buildRemovalEdit([hit], document);
    // Removing a resource is never the default lightbulb pick.
    action.isPreferred = false;
    return [action];
  }

  private forget(path: string): void {
    this.collection.delete(vscode.Uri.file(path));
    this.byPath.delete(path);
  }

  dispose(): void {
    this.collection.dispose();
    for (const s of this.subs) s.dispose();
  }
}

/**
 * Builds the removal edit for a set of findings, recomputing every range
 * against the CURRENT file content.
 *
 * The offsets carried by a finding date from the scan. Rather than invent an
 * invalidation protocol, rescan: a variant that no longer declares the key is
 * simply skipped, which removes an entire class of stale-range bugs.
 */
export async function buildRemovalEdit(
  findings: readonly UnusedResourceKey[],
  openDocument?: vscode.TextDocument,
): Promise<vscode.WorkspaceEdit> {
  const edit = new vscode.WorkspaceEdit();
  const decoder = new TextDecoder();
  const textByPath = new Map<string, string>();

  const readText = async (p: string): Promise<string | undefined> => {
    if (textByPath.has(p)) return textByPath.get(p);
    let text: string | undefined;
    if (openDocument && openDocument.uri.fsPath === p) {
      text = openDocument.getText();
    } else {
      try {
        text = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(p)));
      } catch {
        text = undefined;
      }
    }
    if (text !== undefined) textByPath.set(p, text);
    return text;
  };

  // Group per file so several dead keys in one file are planned back to front.
  const perFile = new Map<string, { finding: UnusedResourceKey; variant: ValueKeyDeclaration }[]>();
  for (const finding of findings) {
    for (const variant of finding.variants) {
      const list = perFile.get(variant.path) ?? [];
      list.push({ finding, variant });
      perFile.set(variant.path, list);
    }
  }

  for (const [p, items] of perFile) {
    const text = await readText(p);
    if (text === undefined) continue;
    const fresh = collectValueKeyDeclarations(p, text);

    const ranges: { start: number; end: number; label: string }[] = [];
    for (const { finding, variant } of items) {
      const match = fresh.find(d => d.kind === finding.kind && d.name === finding.name);
      if (!match) continue; // the key moved or went away since the scan
      const widened = expandToWholeLines(text, match.start, match.end);
      ranges.push({
        ...widened,
        label: `Delete ${finding.kind} ${finding.name} (${variant.qualifier})`,
      });
    }

    ranges.sort((a, b) => a.start - b.start);
    let previousEnd = -1;
    const lineStarts = buildLineStarts(text);
    for (const r of ranges) {
      if (r.start < previousEnd) continue; // overlapping entries: keep the first
      previousEnd = r.end;
      edit.replace(
        vscode.Uri.file(p),
        new vscode.Range(offsetToPosition(lineStarts, r.start), offsetToPosition(lineStarts, r.end)),
        '',
        { needsConfirmation: true, label: r.label },
      );
    }
  }

  return edit;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetToPosition(starts: readonly number[], offset: number): vscode.Position {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return new vscode.Position(low, offset - starts[low]);
}
