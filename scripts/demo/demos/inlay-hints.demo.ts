import { Stage } from '../lib/stage';

/**
 * Demo: Inlay Hints — inferred types and parameter names rendered
 * inline, AND clickable to navigate to the source declaration.
 *
 * Story: a dev reads a function call where parameter names appear as
 * faint inline hints (`id:`, `name:`, `type:`). The hints aren't just
 * decoration — Cmd+Click on a hint jumps to the parameter's
 * declaration in the function signature. Useful when you want to see
 * if the source uses English vs French naming, or to read the param's
 * KDoc directly.
 *
 * Multi-line emphasis: scroll through several call-site sections so
 * the viewer sees the hints adapt to different signatures, default
 * args, lambdas — the pattern is universal.
 *
 * WOW: zero LSP, zero JVM, hints rendered AND navigable.
 *
 * Narrative: Setup (open at inferred-type demo) → Reveal (caption
 * naming the type hints) → Multi-line scroll (param names too, across
 * several functions) → Action (Cmd+Click on a hint → jump to source)
 * → Relief. ~13 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: open at `demoInferredTypes` (line 27, 1-idx = line 26, 0-idx).
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 26, column: 0 },
  );
  await stage.pause(2500);
  // Past EOL (line is 80 chars incl. the `// : Pokemon` comment).
  // Col 62 used to land inside `ELECTRIC` (spans cols 58-65), splitting
  // the enum name visually: `ELECT ◀ inferred RIC`.
  void stage.calloutAt({ line: 27, column: 80 }, 'inferred', 2400);
  await stage.caption('What type is each `val` here?', {
    duration: 2800,
  });

  // Multi-line: scroll down through `demoParamNames` and beyond, so the
  // viewer sees the hint mechanism adapt across multiple signatures.
  // 12 lines / 2200 ms = unhurried.
  await stage.scrollThrough({
    fromLine:   26,
    toLine:     40,
    column:     4,
    durationMs: 2200,
  });
  await stage.dwellOn({ line: 40 }, 1200);

  // Bonus beat: the hint is `: Pokemon` on line 27 0-idx (= line 28
  // 1-idx), rendered virtually after `pikachu`. VS Code only renders
  // the inlay hint's own hover on REAL mouse move — keyboard
  // `showHover` at the anchor shows nothing. Workaround that still
  // nails the intent visually: momentarily MATERIALISE the hint by
  // inserting `: Pokemon` as real text at the same column (15), hover
  // on the real word (HoverProvider resolves the Pokemon data class
  // → KDoc + field list), then undo. The popup opens at the exact
  // position of the original inlay — indistinguishable to the viewer.
  await stage.scrollThrough({
    fromLine:   40,
    toLine:     27,
    column:     15,
    durationMs: 1800,
  });
  await stage.dwellOn({ line: 27, column: 15 }, 600);
  await stage.caption('Hover the `: Pokemon` inlay. Definition right there. 👀', {
    duration: 2400,
  });
  // Materialise the inlay: insert `: Pokemon` right after `pikachu`.
  // Atomic edit — the inlay hint provider detects an explicit type
  // and skips the line on its next re-render, so the viewer sees the
  // virtual `: Pokemon` replaced by real, hoverable `: Pokemon` text
  // at the same column. No duplicate label, no flicker.
  await stage.replaceText(27, 'pikachu ', 'pikachu: Pokemon ');
  // Park the caret INSIDE the freshly-inserted `Pokemon` (starts at
  // c17 after the 2-char `: ` prefix; col 20 is the middle of the word
  // so `getWordRangeAtPosition` resolves to `Pokemon`).
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 27, column: 20, reveal: 'if-offscreen' },
  );
  await stage.dwellOn({ line: 27, column: 20 }, 400);
  await stage.runCommand('editor.action.showHover');
  // Hold ~4.5 s so the viewer reads the data class definition.
  await stage.pause(4500);
  await stage.caption('Pokemon revealed at the call site. No jump needed.', {
    duration: 2800,
  });
  // Dismiss the hover, then undo to restore the file to its original
  // shape. The inlay hint returns within the provider's debounced
  // window (~100 ms), leaving the workspace clean for the next
  // recording.
  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});
  await stage.pause(300);
  await stage.runCommand('undo');
  await stage.pause(700);

  await stage.caption('Inlay hints read AND teach. No LSP needed. 🧠', {
    duration: 2600,
  });
}
