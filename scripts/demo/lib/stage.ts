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
  /** How long the overlay card stays visible (ms). Default: 2500 (playbook pacing). */
  duration?: number;
}

export interface KeystrokeOpts {
  /** Human-readable description, e.g. "Navigate Back" */
  label:     string;
  /** How long the overlay banner stays visible (ms). Default: 2500 (playbook pacing). */
  duration?: number;
}

export interface CaptionOpts {
  /** How long the caption stays visible (ms). Default: 2500 (playbook pacing). */
  duration?: number;
}

export interface NavigateOpts {
  /** Shortcut glyph shown on the banner — e.g. "⌘ + ⌥ + ←". */
  shortcut:    string;
  /** Human-readable description shown under the shortcut. */
  label:       string;
  /** VS Code command id to execute. */
  command:     string;
  /** Optional arguments spread into `executeCommand(id, ...args)`. */
  commandArgs?: unknown[];
  /** File suffix + line the command must land on before the banner emits. */
  awaitEditor: { file: string; line: number };
  /** Banner duration (ms). Default 2500 — matches keystroke(). */
  duration?:   number;
  /** Timeout for the waitForEditor probe (ms). Default 4000. */
  timeoutMs?:  number;
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
    // Close any welcome / walkthrough tab that VS Code opens on first launch
    // from a fresh userDataDir. We don't want those in the recorded video.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Close the auxiliary side panel (Chat / AI pane), the bottom panel, and
    // the primary sidebar (file explorer). Playbook §6: file explorer hidden
    // by default — opt-in via stage.showExplorer() only when the demo needs it.
    for (const cmd of [
      'workbench.action.closeAuxiliaryBar',
      'workbench.action.closePanel',
      'workbench.action.closeSidebar',
    ]) {
      await vscode.commands.executeCommand(cmd).then(() => {}, () => {});
    }

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

  // ── Opt-in chrome helpers ──────────────────────────────────────────────────

  /**
   * Re-open the primary sidebar (file explorer). Playbook §6: explorer is
   * hidden by default — call this only when a demo's narrative depends on
   * seeing the file tree (e.g., Find Usages demo).
   */
  async showExplorer(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.explorer').then(() => {}, () => {});
    await this.pause(200);
  }

  /**
   * Re-enable editor tabs. Playbook §6: tabs hidden by default; turn them on
   * for cross-file demos so the viewer sees the file change explicitly.
   */
  async showTabs(): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('workbench.editor.showTabs', 'single', vscode.ConfigurationTarget.Global)
      .then(() => {}, () => {});
    await this.pause(200);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Subtle blue pulse at the landing line for 500 ms. Playbook §5/§8: the
   * pulse uses VS Code primary blue (#007ACC) rather than the old yellow
   * (warning-coloured).
   *
   * Note on the dim-surround attempt: we tried to add a "focus guide" that
   * darkens every non-target line during the same 500 ms window — via both
   * `backgroundColor: rgba(0,0,0,0.7)` and a `color: rgba(255,255,255,0.22)`
   * text-foreground override, and even a canary `rgba(255,0,0,0.9)` red to
   * prove the decoration reached the renderer. NONE of them produced a
   * visible change in the screen capture (while the pulse's `borderColor`
   * renders fine). The extensionTestsPath runtime apparently composites
   * whole-line `backgroundColor`/`color` decorations after the screen
   * recorder snapshot path, so the effect is invisible on the WebP. We
   * keep only the pulse — which IS captured — and leave attention-guidance
   * to the overlay chrome (banner/card/caption).
   */
  private async flashLanding(editor: vscode.TextEditor, line: number): Promise<void> {
    const pulseDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine:     false,
      backgroundColor: 'rgba(0, 122, 204, 0.12)',   // #007ACC halo
      borderColor:     '#007ACC',
      borderWidth:     '0 0 0 3px',
      borderStyle:     'solid',
      overviewRulerColor: '#007ACC',
      overviewRulerLane:  vscode.OverviewRulerLane.Full,
    });
    const range = new vscode.Range(line, 0, line, 0);
    editor.setDecorations(pulseDeco, [range]);
    await this.pause(500);
    pulseDeco.dispose();
  }

  async openFile(relativePath: string, opts: { line?: number; column?: number } = {}): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(path.join(this.opts.workspaceRoot, relativePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (opts.line !== undefined) {
      const pos = new vscode.Position(opts.line, opts.column ?? 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      void this.flashLanding(editor, opts.line);
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
      duration: opts.duration ?? 2500,
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
    void this.flashLanding(targetEd, range.start.line);

    await this.pause(opts.duration ?? 2500);
  }

  /** Record a keyboard shortcut — runs the paired VS Code command and displays
   *  an overlay banner showing what was pressed. The banner timeline event is
   *  emitted IMMEDIATELY, so it appears slightly before the command's visible
   *  effect — a "prime-then-result" rhythm. Use `navigate()` instead for the
   *  inverse "result-then-reveal" rhythm on WOW moments. */
  async keystroke(shortcut: string, opts: KeystrokeOpts): Promise<void> {
    this.timeline.push({
      type:     'keystroke',
      label:    shortcut,
      sublabel: opts.label,
      duration: opts.duration ?? 2500,
    });
  }

  /**
   * Execute a command, wait for the target editor state, THEN emit the
   * keystroke banner. The banner appears in sync with the visible result
   * instead of before it — "you pressed a shortcut, the editor jumped,
   * HERE is what the shortcut was" (result → reveal).
   *
   * Use this for WOW moments where the overlay's timing is part of the
   * payoff. Example — Navigate Back revealing the exact cursor position:
   *
   *   await stage.navigate({
   *     shortcut:    '⌘ + ⌥ + ←',
   *     label:       'Navigate Back',
   *     command:     'kotlinJump.navigateBack',
   *     awaitEditor: { file: 'ApiServiceImpl.kt', line: 4 },
   *   });
   *
   * The pulse-and-dim focus layer still fires on arrival (via
   * `waitForEditor`), so the viewer sees: cursor jump + flash → banner.
   */
  async navigate(opts: NavigateOpts): Promise<void> {
    await this.runCommand(opts.command, ...(opts.commandArgs ?? []));
    await this.waitForEditor(opts.awaitEditor.file, opts.awaitEditor.line, opts.timeoutMs ?? 4000);
    this.timeline.push({
      type:     'keystroke',
      label:    opts.shortcut,
      sublabel: opts.label,
      duration: opts.duration ?? 2500,
    });
  }

  async runCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  /** Wait for the active editor to reach a specific file + line. Flashes the
   *  landing line once the target is reached so the cursor jump is visible. */
  async waitForEditor(fileSuffix: string, line: number, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const active = vscode.window.activeTextEditor;
      if (active && active.document.fileName.endsWith(fileSuffix) && active.selection.active.line === line) {
        void this.flashLanding(active, line);
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`waitForEditor timeout: ${fileSuffix}:L${line}`);
  }

  /** Narrative text overlay at the bottom of the frame. */
  async caption(text: string, opts: CaptionOpts = {}): Promise<void> {
    const duration = opts.duration ?? 2500;
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
