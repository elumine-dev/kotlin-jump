import { Stage } from '../lib/stage';

/**
 * Demo: Go to Implementation — interface declaration → concrete impl in
 * one keystroke.
 *
 * Story: a dev reads an interface (`ApiService.fetchUser`) and wants the
 * actual HTTP code, not the contract. Cmd+F12 jumps straight to the
 * `override fun fetchUser` in `ApiServiceImpl`. No "pick an
 * implementation" panel — single impl, direct jump.
 *
 * WOW: VS Code's native "Go to Definition" on an interface method just
 * lands BACK on the interface (you're already there). Kotlin Jump
 * resolves through the interface to the concrete `override`, which is
 * what you actually wanted to read.
 *
 * Narrative: Setup (interface, cursor on `fetchUser`) → Action (Cmd+F12)
 * → WOW (jump to override) → Relief (one-line takeaway). ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: open the interface, cursor on `fetchUser` (line 4, 1-idx =
  // line 3, 0-idx). Column 17 lands on the `f` of `fetchUser` so the
  // word-level halo brackets the symbol the viewer's eye should track.
  await stage.openFile(
    'src/main/kotlin/com/example/data/ApiService.kt',
    { line: 3, column: 17 },
  );
  // Word-level halo (column provided → flashClickSource) makes it
  // unambiguous WHICH symbol Cmd+F12 will resolve.
  await stage.dwellOn({ line: 3, column: 17 }, 1000);
  // Question caption: the interface contract is visible, but the dev
  // wants the *implementation* — what code actually runs.
  await stage.caption('The contract is here. But where does it actually run?', {
    duration: 2400,
  });

  // Action: Cmd+F12 → Go to Implementation. `navigate()` rather than
  // keystroke+runCommand+waitForEditor for the result-then-reveal rhythm:
  // the editor jumps first, THEN the banner appears with the shortcut.
  // This is the WOW — the viewer sees the jump land, then learns it
  // was a single keystroke.
  await stage.navigate({
    shortcut:    '⌘ + F12',
    label:       'Go to Implementation',
    command:     'editor.action.goToImplementation',
    awaitEditor: { file: 'ApiServiceImpl.kt', line: 4 },
    duration:    2400,
  });
  // Hold so the landing pulse + banner have time to register together.
  await stage.pause(1200);

  // Answer caption — closes the question loop with a single declarative.
  await stage.caption('Straight to the override. 🎯', {
    duration: 2400,
  });
}
