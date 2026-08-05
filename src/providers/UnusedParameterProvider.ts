import * as vscode from 'vscode';
import { parse } from '../indexer/KotlinParser';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-025: unused parameter detection + removal quick fix.
 *
 * Flags three structurally file-local cases (zero false positives by design,
 * false negatives accepted — same philosophy as KJ-009's wildcard rule):
 *   1. `ctorParam` — primary-constructor parameter without val/var
 *   2. `ctorProp`  — `private val`/`private var` constructor property unused in the file
 *   3. `funParam`  — parameter of a `private fun` with a body
 *
 * Never flagged: override/operator/expect/actual/abstract/external/`main`,
 * data/enum/annotation/value classes, interfaces, objects, annotated
 * declarations or parameters, vararg, backticked names, anything under
 * `@Suppress`. Local shadowing and named-argument labels count as usages
 * (false negatives, locked by tests).
 *
 * Rendering: Warning diagnostic + DiagnosticTag.Unnecessary (VS Code fades
 * the range natively). The quick fix removes the declaration AND the matching
 * argument at every unambiguous call site; ambiguous sites (overloads,
 * homonym classes, `::references`) are skipped, and cross-file edits go
 * through the Refactor Preview (needsConfirmation).
 */

export type { UnusedParam, UnusedParamKind, CallEdit, CallScanResult } from './unusedParameters';
export { findUnusedParameters, computeCallSiteEdits } from './unusedParameters';
import { findUnusedParameters, computeCallSiteEdits } from './unusedParameters';
import type { UnusedParam } from './unusedParameters';

// The pure scanning primitives moved to src/util/kotlinScan.ts so a plain Node
// script can run them without an extension host.
// Re-exported: the KJ-025/026/027/028/030/031 suites import them from here.
export {
  FILE_SUPPRESS_RE, suppressesDiagnostic, fileOptsOut, fileHeader,
  UNUSED_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE,
  SUPPRESS_NAMES, BENIGN_FUN_ANNOTATIONS,
  buildLineStarts, offsetToPos, collectAnnotationTargets,
  findCtorParen, splitParamSegments, matchBrace, depthZeroColon,
} from '../util/kotlinScan';
export type { Seg } from '../util/kotlinScan';
import { buildLineStarts, offsetToPos } from '../util/kotlinScan';


// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedParameters';
const DEBOUNCE_MS = 400;

function toRange(text: string, start: number, end: number): vscode.Range {
  const lineStarts = buildLineStarts(text);
  const s = offsetToPos(lineStarts, start);
  const e = offsetToPos(lineStarts, end);
  return new vscode.Range(s.line, s.character, e.line, e.character);
}

export class UnusedParameterProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-parameters');
  private readonly _subs: vscode.Disposable[];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) this._refreshDebounced();
      }),
      vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`kotlinJump.${CONFIG_KEY}`)) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refreshDebounced(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refresh(), DEBOUNCE_MS);
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
    if (!enabled) {
      this._collection.clear();
      reportDecorations('unusedParams', 0);
      return;
    }

    const unused = findUnusedParameters(editor.document.getText());
    const diags = unused.map(u => {
      const noun = u.kind === 'ctorProp' ? 'Property' : 'Parameter';
      const d = new vscode.Diagnostic(
        new vscode.Range(u.line, u.character, u.line, u.character + u.name.length),
        `${noun} '${u.name}' is never used`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-parameter';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('unusedParams', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class UnusedParameterCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findUnusedParameters(text).filter(u => u.line === range.start.line);
    if (targets.length === 0) return [];

    const actions: vscode.CodeAction[] = [];
    for (const param of targets) {
      const removeAction = await this._buildRemoveAction(document, text, param);
    if (removeAction) actions.push(removeAction);
      actions.push(this._buildSuppressAction(document, text, param));
    }
    return actions;
  }

  private async _buildRemoveAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): Promise<vscode.CodeAction | undefined> {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, toRange(text, param.declStart, param.declEnd));

    const symbols = parse('inline', text).symbols;
    const ownerDecls = symbols.filter(s => s.name === param.ownerName).length;

    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;

    if (ownerDecls > 1) {
      // overloads / homonym in the same file: every call site is ambiguous
      skipped++;
    } else {
      const local = computeCallSiteEdits(text, param);
      skipped += local.skipped;
      for (const e of local.edits) {
        // the declaration deletion may overlap a `this(…)` match — guard
        if (e.start >= param.declStart && e.start < param.declEnd) continue;
        edit.delete(document.uri, toRange(text, e.start, e.end));
        argCount++;
      }
      if (local.edits.length > 0) fileCount = 1;

      if (param.kind !== 'funParam') {
        const cross = await this._crossFileEdits(document, param, edit);
        // A truncated scan may have missed the one call site that matters, and
        // missing one means a broken build. Offer no removal at all.
        if (cross.truncated) return undefined;
        argCount += cross.argCount;
        fileCount += cross.fileCount;
        skipped += cross.skipped;
      }
    }

    let title = `Remove unused parameter '${param.name}'`;
    if (argCount > 0) {
      title += ` and ${argCount} argument${argCount > 1 ? 's' : ''}`;
      if (fileCount > 1) title += ` in ${fileCount} files`;
    }
    if (skipped > 0) title += ` (${skipped} ambiguous site${skipped > 1 ? 's' : ''} skipped)`;

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.isPreferred = true;
    return action;
  }

  private async _crossFileEdits(
    document: vscode.TextDocument,
    param: UnusedParam,
    edit: vscode.WorkspaceEdit,
  ): Promise<{ argCount: number; fileCount: number; skipped: number; truncated?: boolean }> {
    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;
    // Java callers were invisible here, so the fix could delete a parameter a
    // `new Owner(a, b)` still passes. The cap matters just as much: truncating
    // means missing call sites, which means a broken build, so the family's
    // rule "a truncated corpus produces nothing" applies and we refuse.
    const CAP = 20000;
    const files = await vscode.workspace.findFiles(
      '**/*.{kt,java}', '**/{node_modules,build,.git,out,dist}/**', CAP);
    if (files.length >= CAP) return { argCount: 0, fileCount: 0, skipped: 0, truncated: true };
    const declRe = new RegExp(`\\b(?:class|interface|object)\\s+${param.ownerName}\\b`);
    const decoder = new TextDecoder();
    for (const uri of files) {
      if (uri.toString() === document.uri.toString()) continue;
      let other: string;
      try {
        other = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        continue;
      }
      if (!other.includes(param.ownerName)) continue;
      if (declRe.test(other)) {
        // homonym class declared elsewhere: this file's call sites are ambiguous
        skipped++;
        continue;
      }
      const res = computeCallSiteEdits(other, param, uri.fsPath.endsWith('.java') ? 'java' : 'kotlin');
      skipped += res.skipped;
      if (res.edits.length === 0) continue;
      fileCount++;
      for (const e of res.edits) {
        edit.delete(uri, toRange(other, e.start, e.end), {
          needsConfirmation: true,
          label: `Remove argument for '${param.name}'`,
        });
        argCount++;
      }
    }
    return { argCount, fileCount, skipped };
  }

  private _buildSuppressAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): vscode.CodeAction {
    // parameter-site suppression works for all three kinds and keeps the edit
    // local; inserted before the modifiers (`@Suppress(…) private val x`)
    const id = param.kind === 'ctorProp' ? 'unused' : 'UNUSED_PARAMETER';
    const pos = offsetToPos(buildLineStarts(text), param.annotationInsert);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(pos.line, pos.character), `@Suppress("${id}") `);
    const action = new vscode.CodeAction(`Suppress with @Suppress("${id}")`, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    return action;
  }
}
