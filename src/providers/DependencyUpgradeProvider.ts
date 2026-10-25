import * as vscode from 'vscode';
import type { Dependency, EditSpan, Finding, Policy, RailFinding } from '../upgrades/model';
import { fileKindOf, type GradleFileKind } from '../upgrades/UpgradeEngine';
import {
  codeFor, fixesFor, hoverFor, isReported, messageFor, reanchor, releaseNotesUrl, repositoryUrl, severityFor,
  type BumpEdits, type Fix, type FixExtras,
} from './dependencyUpgrades';
import { corpusUri } from '../util/corpusUri';

/**
 * KJ-082 VS Code shell: the diagnostics, the quick fixes and the hover of
 * dependency upgrades.
 *
 * Follows the KJ-041 shell: one diagnostic collection, `kotlin-jump` as the
 * source, a fix offered only against the CURRENT text, findings placed
 * through `corpusUri` so they land on the right file on vscode.dev. Unlike
 * KJ-041 an edit does not drop the whole file: the findings are re-anchored
 * by key, so bumping one line keeps the five other underlines in place.
 */

export type FindingsOrigin = 'open' | 'command';

export interface FileFindings {
  kind: GradleFileKind;
  findings: Finding[];
  rails: RailFinding[];
  origin: FindingsOrigin;
}

export interface ProviderDeps {
  policy: () => Policy;
  /** `UpgradeEngine.bumpEdits` bound to a text reader. */
  bump: BumpEdits;
  wrapperRequirement?: FixExtras['wrapperRequirement'];
  /** The current text of a file, for the comment fix and for edits in another file. */
  textOf: (file: string) => string | undefined;
  now?: () => number;
}

export const APPLY_COMMAND = 'kotlin-jump.applyDependencyUpgrades';

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function positionIn(starts: readonly number[], offset: number): vscode.Position {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return new vscode.Position(lo, offset - starts[lo]);
}

function rangeIn(starts: readonly number[], start: number, end: number): vscode.Range {
  return new vscode.Range(positionIn(starts, start), positionIn(starts, end));
}

export class DependencyUpgradeProvider implements vscode.CodeActionProvider, vscode.HoverProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-dependency-upgrades');
  private readonly byFile = new Map<string, FileFindings>();
  private readonly listeners = new Set<(files: string[]) => void>();
  private readonly subs: vscode.Disposable[];

  constructor(private readonly deps: ProviderDeps) {
    this.subs = [
      vscode.workspace.onDidChangeTextDocument(e => this.handleChange(e.document)),
      vscode.workspace.onDidCloseTextDocument(d => this.handleClose(d)),
    ];
  }

  /** Fires with the files whose findings changed; the badges repaint on it. */
  onDidUpdate(listener: (files: string[]) => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  findingsFor(file: string): FileFindings | undefined {
    return this.byFile.get(file);
  }

  files(): string[] {
    return [...this.byFile.keys()];
  }

  setFindings(file: string, kind: GradleFileKind, text: string, findings: readonly Finding[], rails: readonly RailFinding[], origin: FindingsOrigin): void {
    this.byFile.set(file, { kind, findings: [...findings], rails: [...rails], origin });
    this.publish(file, text);
    this.notify([file]);
  }

  forget(file: string): void {
    this.byFile.delete(file);
    this.collection.delete(corpusUri(file));
    this.notify([file]);
  }

  clear(): void {
    const files = this.files();
    this.byFile.clear();
    this.collection.clear();
    this.notify(files);
  }

  private notify(files: string[]): void {
    for (const l of this.listeners) l(files);
  }

  private publish(file: string, text: string): void {
    const entry = this.byFile.get(file);
    if (!entry) return;
    const starts = lineStartsOf(text);
    const diags: vscode.Diagnostic[] = [];
    for (const f of entry.findings) {
      if (!isReported(f)) continue;
      const d = new vscode.Diagnostic(
        rangeIn(starts, f.dependency.range.start, f.dependency.range.end),
        messageFor(f),
        severityFor(f) === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      d.source = 'kotlin-jump';
      const target = f.verdict.kind === 'newer'
        ? releaseNotesUrl(f.dependency, f.verdict.to) ?? repositoryUrl(f.dependency, f.verdict.candidate.repository)
        : repositoryUrl(f.dependency, undefined);
      d.code = target ? { value: codeFor(f), target: vscode.Uri.parse(target) } : codeFor(f);
      diags.push(d);
    }
    for (const r of entry.rails) {
      const d = new vscode.Diagnostic(
        rangeIn(starts, r.dependency.range.start, r.dependency.range.end),
        r.message,
        r.compatiblePick ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      d.source = 'kotlin-jump';
      const target = releaseNotesUrl(r.dependency, r.compatiblePick ?? r.dependency.currentVersion ?? '') ?? repositoryUrl(r.dependency, undefined);
      d.code = target ? { value: 'incompatible-upgrade', target: vscode.Uri.parse(target) } : 'incompatible-upgrade';
      diags.push(d);
    }
    if (diags.length === 0) this.collection.delete(corpusUri(file));
    else this.collection.set(corpusUri(file), diags);
  }

  /** The findings of the file re-read by key after an edit: the changed entry drops, the others move. */
  handleChange(document: vscode.TextDocument): void {
    const file = document.uri.fsPath;
    const entry = this.byFile.get(file);
    if (!entry) return;
    const text = document.getText();
    const findings = reanchor(text, file, entry.kind, entry.findings);
    const keys = new Map(findings.map(f => [f.dependency.key, f.dependency]));
    const rails = entry.rails.flatMap(r => {
      const d = keys.get(r.dependency.key);
      return d ? [{ ...r, dependency: d, edits: r.edits?.map(e => (e.file === file && r.dependency.versionSite && d.versionSite && e.start === r.dependency.versionSite.start ? { ...e, start: d.versionSite.start, end: d.versionSite.end } : e)) }] : [];
    });
    this.byFile.set(file, { ...entry, findings, rails });
    this.publish(file, text);
    this.notify([file]);
  }

  handleClose(document: vscode.TextDocument): void {
    const file = document.uri.fsPath;
    if (this.byFile.get(file)?.origin === 'open') this.forget(file);
  }

  private findingsAt(document: vscode.TextDocument, line: number): { entry: FileFindings; findings: Finding[] } | undefined {
    const entry = this.byFile.get(document.uri.fsPath);
    if (!entry) return undefined;
    const text = document.getText();
    const starts = lineStartsOf(text);
    const findings = entry.findings.filter(f => positionIn(starts, f.dependency.range.start).line === line);
    return { entry, findings };
  }

  /** The literal is still what the finding was computed on. */
  private stillThere(document: vscode.TextDocument, d: Dependency): boolean {
    const site = d.versionSite;
    if (!site) return false;
    const starts = lineStartsOf(document.getText());
    return document.getText(rangeIn(starts, site.start, site.end)) === site.text;
  }

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    const at = this.findingsAt(document, range.start.line);
    if (!at) return [];
    const file = document.uri.fsPath;
    const report = { findings: at.entry.findings, rails: at.entry.rails, pendingKeys: [], catalogUnparsed: false };
    const out: vscode.CodeAction[] = [];
    for (const f of at.findings) {
      if (!isReported(f) && !at.entry.rails.some(r => r.dependency.key === f.dependency.key)) continue;
      if (!this.stillThere(document, f.dependency)) continue;
      const fixes = fixesFor(f, report, this.deps.policy(), p => (p === file ? document.getText() : this.deps.textOf(p)), this.deps.bump, { wrapperRequirement: this.deps.wrapperRequirement });
      for (const fix of fixes) {
        const action = this.actionFor(fix, file, document);
        if (action) out.push(action);
      }
    }
    return out;
  }

  private actionFor(fix: Fix, file: string, document: vscode.TextDocument): vscode.CodeAction | undefined {
    const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
    action.isPreferred = fix.preferred;
    if (fix.kind === 'bulk') {
      action.command = { command: APPLY_COMMAND, title: fix.title, arguments: [file, fix.tier] };
      return action;
    }
    if (fix.disabledReason) action.disabled = { reason: fix.disabledReason };
    const edit = this.workspaceEdit(fix.edits, file, document);
    if (!edit) return undefined;
    action.edit = edit;
    return action;
  }

  /** Offsets become Positions against the text of each file the spans touch. */
  private workspaceEdit(spans: readonly EditSpan[], file: string, document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
    if (spans.length === 0) return undefined;
    const edit = new vscode.WorkspaceEdit();
    const starts = new Map<string, number[]>();
    for (const span of spans) {
      let s = starts.get(span.file);
      if (!s) {
        const text = span.file === file ? document.getText() : this.deps.textOf(span.file);
        if (text === undefined) return undefined;
        s = lineStartsOf(text);
        starts.set(span.file, s);
      }
      const uri = span.file === file ? document.uri : corpusUri(span.file);
      edit.replace(uri, rangeIn(s, span.start, span.end), span.newText);
    }
    return edit;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const entry = this.byFile.get(document.uri.fsPath);
    if (!entry) return undefined;
    const starts = lineStartsOf(document.getText());
    const offset = starts[position.line] + position.character;
    const f = entry.findings.find(x => x.dependency.range.start <= offset && offset <= x.dependency.range.end);
    if (!f) return undefined;
    const md = new vscode.MarkdownString(hoverFor(f, entry.rails, this.deps.now?.() ?? Date.now()));
    return new vscode.Hover(md, rangeIn(starts, f.dependency.range.start, f.dependency.range.end));
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}

export { fileKindOf };
