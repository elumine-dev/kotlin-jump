import { Stage } from '../lib/stage';

/**
 * Demo: Test Navigator — Alt+Shift+T toggles between any
 * implementation and its test, either direction.
 *
 * Why it matters: test and impl live in different source sets
 * (`src/main` vs `src/test`), often in mirrored package trees.
 * Jumping between them manually means fighting the file tree.
 * kotlin-jump infers the pairing from Gradle source sets and makes
 * it one keystroke, both directions.
 *
 * Four beats:
 *   1. Land on `refreshUsers()` — concrete anchor for the question.
 *   2. Alt+Shift+T → `UserViewModelTest`; land on the matching
 *      `testRefreshUsers_returnsEmptyInitially` test.
 *   3. Alt+Shift+T again → back to the impl, same line.
 *   4. Closer + extra pause so the fade-to-black at the end is
 *      visible in the final webp.
 *
 * ~14 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Anchor on the impl method ───────────────────────────────
  // UserViewModel.kt line 22 (0-idx) = `    fun refreshUsers() {`.
  // Cursor inside the method name so `goToTest` resolves cleanly.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/UserViewModel.kt',
    { line: 22, column: 8 },
  );
  await stage.dwellOn({ line: 22, column: 8 }, 1000);
  await stage.caption('Reading `refreshUsers`. But how is it tested?', {
    duration: 2200,
  });

  // ── Beat 2: Hop to the test ─────────────────────────────────────────
  // `kotlin-jump.goToTest` opens UserViewModelTest.kt. `vscode.open`
  // doesn't set a caret, so we follow up with `openFile` to land on
  // the exact test method (line 31 0-idx = the first refreshUsers
  // test — `testRefreshUsers_returnsEmptyInitially`).
  await stage.navigate({
    shortcut:    '⌥ + ⇧ + T',
    label:       'Go to Test',
    command:     'kotlin-jump.goToTest',
    awaitEditor: { file: 'UserViewModelTest.kt' },
    duration:    2000,
  });
  await stage.openFile(
    'src/test/kotlin/com/example/ui/UserViewModelTest.kt',
    { line: 31, column: 8 },
  );
  await stage.dwellOn({ line: 31, column: 8 }, 900);
  await stage.caption('Straight onto the matching test. No file-tree hunt. 🧪', {
    duration: 2600,
  });

  // ── Beat 3: Same shortcut, opposite direction ───────────────────────
  // The lesson is the TOGGLE — one keystroke, both ways.
  await stage.navigate({
    shortcut:    '⌥ + ⇧ + T',
    label:       'Back to Implementation',
    command:     'kotlin-jump.goToTest',
    awaitEditor: { file: 'UserViewModel.kt' },
    duration:    2000,
  });
  await stage.pause(800);
  await stage.caption('Same keystroke. Back to the impl. Test ↔ impl, always. 🔄', {
    duration: 2600,
  });

  // ── Beat 4: Breathing room for the fade-to-black ────────────────────
  // The ffmpeg pipeline fades the last frames to black. Without a
  // trailing pause, the fade lands ON the caption and the viewer
  // doesn't see "end" cleanly.
  await stage.pause(1200);
}
