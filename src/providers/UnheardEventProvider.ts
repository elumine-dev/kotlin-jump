import * as vscode from 'vscode';
import {
  UnheardEvent,
  UnreadableSubscription,
  createSubscriberTitleFor,
  messageFor,
  removePostTitleFor,
} from './unheardEvents';

/**
 * KJ-038 VS Code shell: diagnostics and the two quick fixes.
 *
 * The detector lives in `unheardEvents.ts` so it runs without an extension
 * host; everything it exports is re-exported here because the rest of the
 * codebase reaches for this file by name.
 */

export * from './unheardEvents';

const CONFIG_KEY = 'unheardEvents';

export class UnheardEventProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unheard-events');
  private readonly byPath = new Map<string, UnheardEvent[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      // A cross-file claim cannot be recomputed from one buffer, so an edited
      // file loses its findings until the next scan. A stale "nobody listens"
      // claim is the dangerous kind: acting on it deletes working behaviour.
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  setFindings(findings: readonly UnheardEvent[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const list = this.byPath.get(f.path) ?? [];
      list.push(f);
      this.byPath.set(f.path, list);

      const range = new vscode.Range(f.line, f.character, f.line, f.character + 4);
      const d = new vscode.Diagnostic(range, messageFor(f), f.verdict === 'unheard'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information);
      // No DiagnosticTag.Unnecessary anywhere here, and that is deliberate.
      // The post is not superfluous: nine times out of ten the SUBSCRIBER is
      // what went missing. Striking the post through pushes the reader to
      // delete the wrong side of the pair.
      d.source = 'kotlin-jump';
      d.code = f.verdict === 'unheard' ? 'unheard-event' : `${f.verdict}-event`;
      const diags = byFile.get(f.path) ?? [];
      diags.push(d);
      byFile.set(f.path, diags);
    }

    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  /**
   * Publishes the subscriptions that stopped the scan from proving anything.
   *
   * Reporting these is not a nicety. A silent zero reads as "all clear", when
   * in fact a hole in the subscription set meant nothing could be checked.
   */
  setUnreadable(subscriptions: readonly UnreadableSubscription[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const s of subscriptions) {
      const range = new vscode.Range(s.line, s.character, s.line, s.character + 1);
      const d = new vscode.Diagnostic(
        range,
        'Kotlin Jump cannot read this subscription\'s event type. While it stays unreadable, '
        + 'no event can be reported as unheard. Add the type to '
        + 'kotlinJump.unheardEventsAssumeSubscribed to scan anyway.',
        vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'kotlin-jump';
      d.code = 'unreadable-subscription';
      const diags = byFile.get(s.path) ?? [];
      diags.push(d);
      byFile.set(s.path, diags);
    }

    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  findingsFor(path: string): UnheardEvent[] | undefined {
    return this.byPath.get(path);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!UnheardEventProvider.isEnabled()) return [];
    const findings = this.byPath.get(document.uri.fsPath);
    if (!findings?.length) return [];

    const hit = findings.find(f => f.line === range.start.line);
    if (!hit) return [];

    // Re-verify against the CURRENT text: an offset from the last scan must
    // never aim an edit at a line that has since moved.
    const lineText = document.lineAt(hit.line).text;
    if (!lineText.includes('post')) return [];

    const actions: vscode.CodeAction[] = [];

    if (hit.removeStart !== -1) {
      const action = new vscode.CodeAction(removePostTitleFor(hit), vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      edit.delete(
        document.uri,
        new vscode.Range(document.positionAt(hit.removeStart), document.positionAt(hit.removeEnd)),
        // Rule 3 of the family contract, and it matters more here than
        // anywhere else: nothing catches a deleted post at compile time.
        { needsConfirmation: true, label: removePostTitleFor(hit) },
      );
      action.edit = edit;
      action.isPreferred = false;
      actions.push(action);
    }

    // The other intention, offered side by side: an unheard event usually
    // means the receiver was removed by mistake, so writing the subscriber
    // back is as likely to be the right move as deleting the post.
    const create = new vscode.CodeAction(
      createSubscriberTitleFor(hit),
      vscode.CodeActionKind.QuickFix,
    );
    create.command = {
      command: 'kotlinJump.createEventSubscriber',
      title: createSubscriberTitleFor(hit),
      arguments: [hit.name, hit.fqn],
    };
    actions.push(create);

    const suppress = new vscode.CodeAction(
      'Suppress with // kotlin-jump:ignore unheard-event',
      vscode.CodeActionKind.QuickFix,
    );
    const suppressEdit = new vscode.WorkspaceEdit();
    const indent = /^[ \t]*/.exec(lineText)?.[0] ?? '';
    suppressEdit.insert(
      document.uri,
      new vscode.Position(hit.line, 0),
      `${indent}// kotlin-jump:ignore unheard-event\n`,
    );
    suppress.edit = suppressEdit;
    actions.push(suppress);

    return actions;
  }

  private forget(path: string): void {
    this.collection.delete(vscode.Uri.file(path));
    this.byPath.delete(path);
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}
