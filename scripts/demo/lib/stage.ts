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

export interface ScrollThroughOpts {
  /** Start line (0-indexed). */
  fromLine:   number;
  /** End line (0-indexed). */
  toLine:     number;
  /** Final column after the scroll. Default 0. */
  column?:    number;
  /**
   * Target total duration of the scroll in ms. Default 1200. The step size
   * and inter-step delay are derived from this so every WebP frame (@ 12 fps
   * ≈ 83 ms/frame) captures the viewport at a different position — no
   * visible stutter, no dependence on hitting a specific stepMs sweet spot.
   */
  durationMs?: number;
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
      // Top + bottom border makes the line POP on the screen recorder — the
      // left-only 3 px stripe on a zero-width range (prior version) rendered
      // as an invisible hairline on WebP. Wrapping the visible line text in
      // a contrasting bracket is captured reliably.
      borderColor:     '#007ACC',
      borderWidth:     '2px 0 2px 0',
      borderStyle:     'solid',
      overviewRulerColor: '#007ACC',
      overviewRulerLane:  vscode.OverviewRulerLane.Full,
    });
    // Range must span actual characters for the border to have something to
    // wrap around. End-of-line position → full line width underlined both top
    // and bottom. Optional chain shields unit-test mocks that don't provide
    // `lineAt` on their fake document; 80-char fallback is generous enough
    // to paint a visible border on any real-world line.
    const lineLen = editor.document.lineAt?.(line)?.text?.length ?? 80;
    const range   = new vscode.Range(line, 0, line, Math.max(1, lineLen));
    editor.setDecorations(pulseDeco, [range]);
    await this.pause(500);
    pulseDeco.dispose();
  }

  async openFile(
    relativePath: string,
    opts: {
      line?:    number;
      column?:  number;
      /** Reveal strategy. `'center'` (default) snaps the target to the viewport
       *  centre — right for cross-file hops. `'if-offscreen'` re-centres only
       *  when the target is outside the current viewport — avoids the micro-
       *  scroll jitter when the cursor moves inside a screen that's already
       *  showing the target. `'default'` uses VS Code's native reveal. */
      reveal?:  'center' | 'if-offscreen' | 'default';
    } = {},
  ): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(path.join(this.opts.workspaceRoot, relativePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (opts.line !== undefined) {
      const pos = new vscode.Position(opts.line, opts.column ?? 0);
      editor.selection = new vscode.Selection(pos, pos);
      const revealType =
        opts.reveal === 'if-offscreen' ? vscode.TextEditorRevealType.InCenterIfOutsideViewport :
        opts.reveal === 'default'      ? vscode.TextEditorRevealType.Default                   :
                                         vscode.TextEditorRevealType.InCenter;
      editor.revealRange(new vscode.Range(pos, pos), revealType);
      void this.flashLanding(editor, opts.line);
    }
    await this.pause(500);
    return editor;
  }

  /**
   * Scroll the caret from `fromLine` to `toLine` as a continuous motion,
   * not a teleport. The step size (in lines) and inter-step delay (in ms)
   * are derived from `durationMs` so that:
   *
   *   1. The total scroll lands within ~durationMs of its target (default 1200 ms).
   *   2. The inter-step delay stays in the 50-80 ms window — tight enough
   *      that each new `cursorMove` fires while VS Code's `smoothScrolling`
   *      animation (~125 ms) is still running, so the animations OVERLAP
   *      and compose into a continuous viewport motion.
   *   3. The step count exceeds the WebP frame count over the duration
   *      (~14 frames at 12 fps for 1200 ms), so every captured frame lands
   *      on a distinct viewport position — no same-frame batching that
   *      would reintroduce stutter.
   *
   * Does NOT flash the landing line — pure motion. Pair with `dwellOn()`
   * if the landing deserves narrative emphasis.
   */
  async scrollThrough(opts: ScrollThroughOpts): Promise<vscode.TextEditor> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('scrollThrough(): no active editor');

    const { fromLine, toLine, column = 0, durationMs = 1200 } = opts;
    const startPos = new vscode.Position(fromLine, 0);
    editor.selection = new vscode.Selection(startPos, startPos);
    editor.revealRange(
      new vscode.Range(startPos, startPos),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    // Brief settle so the viewport is stable before the first cursorMove.
    await this.pause(40);

    const delta = toLine - fromLine;
    const abs   = Math.abs(delta);

    if (abs === 0) return editor;

    // 50 ms floor keeps steps inside VS Code's smooth-scroll animation
    // window; 80 ms ceiling keeps every WebP frame on a fresh position.
    const MIN_STEP_MS = 50;
    const MAX_STEP_MS = 80;
    // Floor on the step count: a scroll must be at least 4 steps long —
    // otherwise even a "scrollThrough" of 30 lines with a tiny durationMs
    // would collapse into a single cursorMove and re-teleport. We'd rather
    // overrun durationMs than silently regress on the core promise.
    const MIN_N_STEPS = 4;
    const budgetSteps = Math.floor(durationMs / MIN_STEP_MS);
    const maxSteps    = Math.max(MIN_N_STEPS, budgetSteps);
    const stepLines   = Math.max(1, Math.ceil(abs / maxSteps));
    const nSteps      = Math.ceil(abs / stepLines);
    const rawStepMs   = Math.round(durationMs / nSteps);
    const stepMs      = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, rawStepMs));

    const dir = delta > 0 ? 'down' : 'up';
    let remaining = abs;
    for (let i = 0; i < nSteps; i++) {
      const step = Math.min(remaining, stepLines);
      await vscode.commands.executeCommand('cursorMove', { to: dir, by: 'line', value: step });
      remaining -= step;
      // Don't pause after the final step — let the caller's dwell start
      // immediately instead of adding an idle tail.
      if (i < nSteps - 1) await this.pause(stepMs);
    }

    // Final column alignment — `cursorMove by: 'line'` preserves column but
    // may clamp if an intermediate line is shorter; reset explicitly.
    const endPos = new vscode.Position(toLine, column);
    editor.selection = new vscode.Selection(endPos, endPos);
    return editor;
  }

  /**
   * Strong, word-sized halo at the current caret position, visible for
   * ~450 ms. Used by `click()` to show WHERE the click landed before the
   * navigation jumps away — without this, the demo announces "Cmd+Click on
   * X" but nothing on the editor surface confirms the source location.
   *
   * Visually distinct from `flashLanding`:
   *   - word range (not full line)
   *   - higher opacity (0.28 vs 0.12)
   *   - full border (not just the left gutter)
   */
  private async flashClickSource(editor: vscode.TextEditor, pos: vscode.Position): Promise<void> {
    const wordRange =
      editor.document.getWordRangeAtPosition?.(pos) ??
      new vscode.Range(pos, new vscode.Position(pos.line, pos.character + 1));
    // Thick solid border + visible sidekick marker. VS Code's screencapture
    // path drops semi-transparent backgrounds, so we stay border-only and
    // use a thicker stroke (3 px) + an `after` token that IS captured. The
    // combination makes the caret position impossible to miss.
    const deco = vscode.window.createTextEditorDecorationType({
      borderColor:     '#007ACC',
      borderWidth:     '3px',
      borderStyle:     'solid',
      borderRadius:    '3px',
      overviewRulerColor: '#007ACC',
      overviewRulerLane:  vscode.OverviewRulerLane.Full,
      after: {
        contentText:     ' ◀',
        color:           '#007ACC',
        fontWeight:      'bold',
        margin:          '0 0 0 6px',
      },
    });
    editor.setDecorations(deco, [wordRange]);
    // Longer dwell (was 450 ms). 850 ms puts the halo on ~10 frames at
    // 12 fps — enough that the viewer's eye certainly registers it.
    await this.pause(850);
    deco.dispose();
  }

  /**
   * Narrative dwell on a specific line — `flashLanding` halo + pause. Use
   * instead of a bare `pause()` when the intent is "hold the viewer's eye
   * on this landing spot", not just "wait for the screen to settle".
   *
   * When `column` is provided, applies the stronger `flashClickSource`
   * word-level halo instead — useful when the viewer needs to see exactly
   * which symbol the cursor is on (e.g. before pressing Alt+F7 on a
   * specific method name).
   */
  async dwellOn(target: { line: number; column?: number }, ms: number): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    if (ed) {
      if (target.column !== undefined) {
        void this.flashClickSource(ed, new vscode.Position(target.line, target.column));
      } else {
        void this.flashLanding(ed, target.line);
      }
    }
    await this.pause(ms);
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

    // Show WHERE the click landed BEFORE the navigation whisks us away —
    // otherwise the card overlay announces "Cmd+Click on X" with no visible
    // confirmation on the editor surface. The halo stays ~450 ms before the
    // jump fires.
    await this.flashClickSource(editor, pos);

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
