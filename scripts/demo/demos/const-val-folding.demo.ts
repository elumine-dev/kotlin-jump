import { Stage } from '../lib/stage';

/**
 * Demo: ConstVal Inline Folding — new ordering.
 *
 * Previous version ended on the Go-to-Definition landing inside
 * `object CatchConfig`, which produced a boring poster frame (just a
 * list of `const val` declarations). The fold/unfold reveal — the
 * actual WOW of this feature — was buried in the middle.
 *
 * New order:
 *   1. Open on folded literals at the usage site.
 *   2. Cmd+Click a SCREAMING_CASE → Go to Definition jumps to
 *      `CatchConfig`. Brief scroll in the declarations.
 *   3. Navigate Back → return to the caller.
 *   4. Scroll down through the folded variants (defaults, when,
 *      collections, interpolation).
 *   5. Multi-line selection over the dense `constValLocalUsage`
 *      block → the fold lifts on every selected line, the raw
 *      SCREAMING_CASE names reappear. Closing frame = fold/unfold
 *      side-by-side, the actual hero shot.
 *
 * ~22 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Open on folded literals ─────────────────────────────────
  // Sprint2VisualDemo.kt line 39 (0-idx) = line 40 (1-idx) =
  // `fun constValLocalUsage() {`. Cursor on the function header so
  // every `CatchConfig.*` below shows its literal value.
  await stage.openFile(
    'src/main/kotlin/com/example/sprint2/Sprint2VisualDemo.kt',
    { line: 39, column: 0 },
  );
  await stage.pause(2200);
  await stage.caption('Consts folded inline. But where do the values live?', {
    duration: 2400,
  });

  // ── Beat 2: Cmd+Click → Go to Definition ────────────────────────────
  // MAX_ATTEMPTS on line 40 (0-idx): `    val maxTries   = CatchConfig.MAX_ATTEMPTS`
  // Col 38 lands inside the word; resolves to `object CatchConfig`.
  await stage.openFile(
    'src/main/kotlin/com/example/sprint2/Sprint2VisualDemo.kt',
    { line: 40, column: 38 },
  );
  await stage.dwellOn({ line: 40, column: 38 }, 700);
  await stage.click('MAX_ATTEMPTS', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  await stage.waitForEditor('Sprint2VisualDemo.kt', 25);
  await stage.pause(900);
  await stage.caption('Cmd+Click. Land on the `const val`.', {
    duration: 2200,
  });

  // ── Beat 3: Brief scroll inside CatchConfig ─────────────────────────
  // The object declaration spans lines 23-35 (0-idx). A short scroll
  // shows the siblings — SHINY_RATE, POKEBALL_BASE_RATE, etc.
  await stage.scrollThrough({
    fromLine:   25,
    toLine:     35,
    column:     4,
    durationMs: 1600,
  });
  await stage.dwellOn({ line: 35 }, 600);

  // ── Beat 4: Navigate Back ───────────────────────────────────────────
  // Cmd+Alt+Left rewinds the nav stack, restoring exact line + column.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    // Don't pin a line — kotlinJump.navigateBack may land on the
    // previous caret position (line 40) OR the file's top if the
    // nav stack was reset. Match by file only.
    awaitEditor: { file: 'Sprint2VisualDemo.kt' },
    duration:    2000,
  });
  await stage.pause(700);

  // ── Beat 5: Scroll down through folded variants ─────────────────────
  // Default params → when → collections → interpolation. Each block
  // holds ~1 s on screen so the viewer sees folding applies everywhere.
  await stage.scrollThrough({
    fromLine:   40,
    toLine:     82,
    column:     4,
    durationMs: 3200,
  });
  await stage.dwellOn({ line: 82 }, 800);

  // ── Beat 6: Scroll back up, then multi-line select → fold/unfold ───
  // Back to the dense `constValLocalUsage` block (lines 40-47 0-idx).
  // Selecting all 8 lines flips them to raw SCREAMING_CASE at once.
  await stage.scrollThrough({
    fromLine:   82,
    toLine:     40,
    column:     4,
    durationMs: 1800,
  });
  await stage.dwellOn({ line: 40 }, 500);
  await stage.caption('Select the block. Names come back. ✍️', {
    duration: 2400,
  });
  await stage.selectLines(40, 47);
  // The closing frame — what the poster captures. Hold long enough
  // that the raw SCREAMING_CASE names register.
  await stage.pause(2800);
  await stage.caption('Folded for reading. Raw for editing. Best of both. 🎯', {
    duration: 2800,
  });
  // Trailing pause so the fade-to-black at end of recording lands
  // on the fold/unfold visual.
  await stage.pause(800);
}
