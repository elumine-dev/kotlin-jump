import { Stage } from '../lib/stage';

/**
 * Demo: Find Usages — two behaviours in one demo.
 *
 * 1. Multi-caller case. `PokedexViewModel.releasePokemon` is called from
 *    two handlers in `PokedexScreen` (button press + swipe delete). Alt+F7
 *    opens the References panel so the dev picks one.
 *
 * 2. Single-caller case. `PokedexScreen.showConfirmation` is called from
 *    exactly one site — `onSwipeDelete`. Alt+F7 skips the panel entirely
 *    and jumps straight to the call-site. Same shortcut, smart behaviour.
 *
 * Narrative: Setup → Action → WOW (panel pick) → Transition → WOW (direct
 * jump) → Relief. ~13 s. Same-file jumps get an extra dwell so the
 * viewer's eye has time to follow the caret without the scroll feeling
 * instantaneous.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ─── Part 1: many callers → References panel opens.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexViewModel.kt',
    { line: 13, column: 16 },
  );
  await stage.caption('Who calls releasePokemon?', { duration: 1500 });

  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages');
  await stage.pause(1800);  // panel renders

  // Pick one of the two callers — the button handler.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexScreen.kt',
    { line: 59, column: 18 },
  );
  await stage.pause(600);  // dwell on the landing line before narrating
  await stage.caption('Two callers. Pick one from the panel.', { duration: 1800 });

  // ─── Part 2: exactly one caller → skip the panel, jump straight.
  //
  // Staged in two beats so the cursor motion stays CONTINUOUS for the
  // viewer (teleport teaser → teleport payoff):
  //   a) Scroll down 6 lines to the `ConfirmationDialog.show(pokemon)` call
  //      site at line 66 (1-indexed). Viewer sees "ah, this line calls
  //      something in another file".
  //   b) Open ConfirmationDialog.kt on the `show` declaration. Flash halo
  //      + 1 s dwell + caption name the landing so the cross-file teleport
  //      is obvious.
  //   c) Alt+F7 → jump BACK across files to the single caller. That round
  //      trip is the real "wow".
  // Land precisely on `s` of `show` in the call `ConfirmationDialog.show(pokemon)`.
  // Column 28 (0-idx) = first char of `show` on line 66 (1-idx) = line 65 (0-idx):
  //   "        ConfirmationDialog.show(pokemon)"
  //    01234567|------|----------------|^--------^
  //             8       18                 28
  // Word-level halo (`dwellOn` with `column`) + block cursor (`cursorStyle
  // = "block"` in demo-settings.json) = the caret is unambiguously on the
  // `s` of `show`, not on `ConfirmationDialog` or elsewhere.
  await stage.scrollThrough({ fromLine: 59, toLine: 65, column: 28, durationMs: 700 });
  await stage.dwellOn({ line: 65, column: 28 }, 800);
  await stage.caption('Cursor on `show`. This call lives elsewhere…', { duration: 1600 });

  await stage.openFile(
    'src/main/kotlin/com/example/ui/ConfirmationDialog.kt',
    { line: 9, column: 8 },    // 0-indexed: `fun show` declaration
  );
  // Word-level halo on `show` itself (via `column: 8`) — makes it
  // unambiguous that Alt+F7 targets the method, not the `ConfirmationDialog`
  // object name above it.
  await stage.dwellOn({ line: 9, column: 8 }, 900);
  await stage.caption('On `show`. Single caller. Alt+F7…', { duration: 1500 });

  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages');
  // Direct cross-file jump to the only call-site in PokedexScreen.kt.
  // Line 65 (0-indexed) = `ConfirmationDialog.show(pokemon)` at 1-indexed 66.
  await stage.waitForEditor('PokedexScreen.kt', 65);
  await stage.pause(900);
  // Answer caption — closes the contrast with the multi-caller case.
  await stage.caption('One caller. Straight there. No picker. 🎯', { duration: 2000 });
}
