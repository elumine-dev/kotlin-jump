import * as vscode from 'vscode';
import * as path from 'node:path';
import { Timeline } from './timeline';

export interface StageOptions {
  /** Absolute path to the demo workspace root (where sample .kt files live) */
  workspaceRoot: string;
}

type Modifier = 'Cmd' | 'Ctrl' | 'Alt' | 'Shift';

export interface ClickOpts {
  /** Modifier key visualised in the overlay card */
  modifier?: Modifier | `${Modifier}+${Modifier}`;
  /** Human-readable action label, e.g. "Go to Definition" */
  label:    string;
  /** How long the overlay card stays visible (ms). Default: 1500. */
  duration?: number;
}

export interface KeystrokeOpts {
  /** Human-readable description, e.g. "Navigate Back" */
  label:     string;
  /** How long the overlay banner stays visible (ms). Default: 1200. */
  duration?: number;
}

export interface CaptionOpts {
  /** How long the caption stays visible (ms). Default: 2000. */
  duration?: number;
}

/**
 * Stage orchestrates the VS Code state during a demo recording and emits timeline
 * events that the overlay generator will use to render annotations in post-processing.
 *
 * This runs inside an `extensionDevelopmentHost` VS Code instance — it has access
 * to the real `vscode` API.
 */
export class Stage {
  readonly timeline = new Timeline();

  constructor(private readonly opts: StageOptions) {}

  // ── Setup ──────────────────────────────────────────────────────────────────

  /**
   * Wait until the Kotlin Jump index has finished building. Without this, the
   * first demo actions can race with indexing and render inconsistent lenses.
   */
  async waitForIndexReady(timeoutMs = 30_000): Promise<void> {
    const kotlinJump = vscode.extensions.getExtension('elumine.kotlin-jump');
    if (!kotlinJump) throw new Error('kotlin-jump extension not found in dev host');
    await kotlinJump.activate();
    // eslint-disable-next-line no-console
    console.log(`[stage] kotlin-jump activated: ${kotlinJump.isActive}`);

    // Probe the workspace: ask VS Code for the definition of the first symbol
    // in ApiServiceImpl.kt. Once the built-in definition provider returns a
    // non-empty result, we know the index is ready to serve navigation.
    const deadline = Date.now() + timeoutMs;
    const probeUri = vscode.Uri.file(path.join(this.opts.workspaceRoot, 'src/main/kotlin/com/example/data/ApiServiceImpl.kt'));

    while (Date.now() < deadline) {
      try {
        const doc  = await vscode.workspace.openTextDocument(probeUri);
        const pos  = new vscode.Position(4, 25);
        const defs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
          'vscode.executeDefinitionProvider',
          doc.uri,
          pos,
        );
        if (defs && defs.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[stage] index ready — definition provider returned ${defs.length} result(s)`);
          return;
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 250));
    }
    // eslint-disable-next-line no-console
    console.log(`[stage] index-ready probe timed out after ${timeoutMs}ms — proceeding anyway`);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async openFile(relativePath: string, opts: { line?: number; column?: number } = {}): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(path.join(this.opts.workspaceRoot, relativePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (opts.line !== undefined) {
      const pos = new vscode.Position(opts.line, opts.column ?? 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    await this.pause(500);
    return editor;
  }

  /** Record a "Cmd+Click on <target>" action and navigate to its definition.
   *
   *  Uses the `vscode.executeDefinitionProvider` API instead of the
   *  `editor.action.revealDefinition` command: the latter is flaky in the
   *  extensionTests host (sometimes returns silently without navigating),
   *  the former reliably returns locations and we open them explicitly.
   */
  async click(target: string, opts: ClickOpts): Promise<void> {
    const modLabel = opts.modifier ? `${opts.modifier}+Click` : 'Click';
    this.timeline.push({
      type:     'click',
      label:    `${modLabel} → ${opts.label}`,
      sublabel: target,
      duration: opts.duration ?? 1500,
    });

    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('click(): no active editor');
    const doc = editor.document;
    const pos = editor.selection.active;

    const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      doc.uri,
      pos,
    );
    if (!locations || locations.length === 0) {
      throw new Error(`click(${target}): no definition found at L${pos.line}:C${pos.character} in ${doc.fileName}`);
    }

    const loc = locations[0];
    const uri   = ('targetUri'   in loc ? loc.targetUri   : loc.uri);
    const range = ('targetRange' in loc ? loc.targetRange : loc.range);
    const targetDoc = await vscode.workspace.openTextDocument(uri);
    const targetEd  = await vscode.window.showTextDocument(targetDoc, { preview: false });
    targetEd.selection = new vscode.Selection(range.start, range.start);
    targetEd.revealRange(range, vscode.TextEditorRevealType.InCenter);

    await this.pause(opts.duration ?? 1500);
  }

  /** Record a keyboard shortcut — runs the paired VS Code command and displays
   *  an overlay banner showing what was pressed. */
  async keystroke(shortcut: string, opts: KeystrokeOpts): Promise<void> {
    this.timeline.push({
      type:     'keystroke',
      label:    shortcut,
      sublabel: opts.label,
      duration: opts.duration ?? 1200,
    });
  }

  async runCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  /** Wait for the active editor to reach a specific file + line. */
  async waitForEditor(fileSuffix: string, line: number, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const active = vscode.window.activeTextEditor;
      if (active && active.document.fileName.endsWith(fileSuffix) && active.selection.active.line === line) {
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`waitForEditor timeout: ${fileSuffix}:L${line}`);
  }

  /** Narrative text overlay at the bottom of the frame. */
  async caption(text: string, opts: CaptionOpts = {}): Promise<void> {
    const duration = opts.duration ?? 2000;
    this.timeline.push({
      type:     'caption',
      label:    text,
      duration,
    });
    await this.pause(duration);
  }

  async pause(ms: number, _reason?: string): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }
}
