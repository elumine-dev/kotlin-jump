import { Stage } from '../lib/stage';

/**
 * Demo: Inlay Hints — inferred type rendered inline, and the class it
 * points to is one hover away. ~11 s.
 *
 * One beat, one payoff. The viewer lands on a `val` with no explicit
 * type, sees the inferred `: Pokemon` inlay appear, then watches the
 * full class KDoc materialise at the same position without jumping to
 * another file.
 *
 * WOW: the virtual inlay is READABLE in place — hint says Pokemon,
 * hover says why.
 *
 * Trimmed from a 22 s three-section version (inferred + param-names
 * scroll + hover). The middle scroll was filler; the hover IS the WOW.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Line 27 (0-idx) = `    val pikachu  = makePokemon(...) // : Pokemon`
  // The inlay hint provider renders `: Pokemon` as virtual text after
  // `pikachu` at col 15. Col 15 positions the caret right where the
  // hint appears — so the viewer's eye is already in the right spot
  // when the callout fires.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 27, column: 15 },
  );
  await stage.pause(1200);
  await stage.caption('What type is `pikachu`?', {
    duration: 2200,
  });

  // Point at the virtual inlay. Past EOL (line is 80 chars incl. the
  // `// : Pokemon` comment); col 80 lands safely at end-of-line.
  void stage.calloutAt({ line: 27, column: 80 }, 'inferred', 1800);
  await stage.dwellOn({ line: 27, column: 15 }, 1300);

  // Materialise the inlay as real text so the hover provider fires on
  // it (inlay-hint hovers only trigger on mouse move, not on keyboard
  // `showHover`). The atomic edit replaces `pikachu ` → `pikachu: Pokemon `
  // at the exact column the virtual hint was rendering — visually
  // indistinguishable from hovering the inlay itself.
  await stage.replaceText(27, 'pikachu ', 'pikachu: Pokemon ');
  // Park the caret INSIDE the freshly-inserted `Pokemon` so
  // `getWordRangeAtPosition` resolves to the class name. Col 20 = `k`
  // of `Pokemon`.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 27, column: 20, reveal: 'if-offscreen' },
  );
  await stage.dwellOn({ line: 27, column: 20 }, 300);
  await stage.runCommand('editor.action.showHover');
  await stage.caption('Inline hint, full KDoc on hover. Zero jump.', {
    duration: 2800,
  });
  // Hold long enough for the reader to parse the data-class signature
  // and field list. Caption stays up ~2.8 s, hover parked ~2.6 s — both
  // fade together naturally.
  await stage.pause(2600);

  // Restore the file: dismiss hover, undo the materialisation. The
  // inlay provider re-renders the virtual `: Pokemon` within its
  // debounced window (~100 ms), leaving the workspace clean.
  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});
  await stage.pause(200);
  await stage.runCommand('undo');
  await stage.pause(500);
}
