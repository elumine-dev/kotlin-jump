import { Stage } from '../lib/stage';

/**
 * Demo: Testing view → filter → click test → run → green → edit +
 *       save → re-run → red → open bottom panel with failure trace.
 *
 * Target: `StarterBattleTest` (Charizard vs Blastoise, 2 tests).
 *
 * Pacing trick: captions are fired as `void stage.caption(...)` during
 * Gradle waits so they overlap the wait instead of adding to it. Pure
 * `await stage.pause(N)` is only used for transitions that need a
 * hard wall-clock beat.
 *
 * Total wall-clock: ~17 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  const TEST_CLASS_FQN = 'com.example.data.StarterBattleTest';
  const MODULE_NAME    = 'kotlin-jump-demo';

  // ── Beat 1: Open the file ───────────────────────────────────────────
  await stage.openFile(
    'src/test/kotlin/com/example/data/StarterBattleTest.kt',
    { line: 13, column: 0 },
  );
  void stage.caption('Charizard vs Blastoise. Classic. Water wins.', { duration: 1400 });
  await stage.pause(1400);

  // ── Beat 2: Open the Testing view ───────────────────────────────────
  await stage.runCommand('workbench.view.testing.focus');
  await stage.pause(400);

  // ── Beat 3: Filter to this test class ───────────────────────────────
  // `list.find` opens the quick-find overlay; typing narrows the tree.
  await stage.runCommand('list.find');
  await stage.pause(150);
  for (const ch of 'StarterBattleTest') {
    await stage.runCommand('type', { text: ch });
    await stage.pause(50);
  }
  await stage.pause(250);

  // ── Beat 4: Reveal the first test body in the editor ────────────────
  // Viewport on the `fun Blastoise beats…` declaration (line 21 0-idx)
  // so the run fires with the right code on screen.
  await stage.openFile(
    'src/test/kotlin/com/example/data/StarterBattleTest.kt',
    { line: 21, column: 8 },
  );
  await stage.dwellOn({ line: 21, column: 8 }, 400);

  // ── Beat 5: Run the class ───────────────────────────────────────────
  await stage.runCommand('kotlin-jump.runTestClass', TEST_CLASS_FQN, MODULE_NAME);
  // Caption overlaps the Gradle wait. Gradle is fast on this fixture.
  void stage.caption('Both green. Water > fire. ✅', { duration: 1500 });
  await stage.pause(3000);

  // ── Beat 6: Flip the expected winner + SAVE ─────────────────────────
  // Line 23 (0-idx): `        assertEquals(blastoise, result.winner)`
  // `blastoise` → `charizard` (9→9 chars, clean visual swap).
  await stage.openFile(
    'src/test/kotlin/com/example/data/StarterBattleTest.kt',
    { line: 23, column: 20 },
  );
  void stage.caption('What if Charizard won? Let’s lie.', { duration: 1500 });
  await stage.typeReplace(23, 'blastoise', 'charizard', {
    backspaceMs: 55,
    typeMs:      75,
    settleMs:    200,
  });
  // CRITICAL: Gradle reads from disk. Without save, the re-run uses
  // the OLD file and the test still passes — the demo lies.
  await stage.runCommand('workbench.action.files.save');
  await stage.pause(200);

  // ── Beat 7: Re-run → red ────────────────────────────────────────────
  await stage.runCommand('kotlin-jump.runTestClass', TEST_CLASS_FQN, MODULE_NAME);
  void stage.caption('Nope. The test knows. 🔴', { duration: 1500 });
  await stage.pause(3000);

  // ── Beat 8: Close sidebar, open the Test Results panel ──────────────
  await stage.runCommand('workbench.action.closeSidebar');
  await stage.pause(200);
  await stage.runCommand('workbench.panel.testResults.view.focus');
  void stage.caption('Full trace. Fix, rerun, rinse.', { duration: 1600 });
  await stage.pause(1600);

  // ── Cleanup: restore the file so the demo is idempotent ─────────────
  // The edit + save left `charizard` on disk. Without this revert, the
  // next recording would fail ("blastoise not found on line 23").
  // No caption — happens off-camera after the final frame.
  await stage.openFile(
    'src/test/kotlin/com/example/data/StarterBattleTest.kt',
    { line: 23, column: 20 },
  );
  await stage.replaceText(23, 'charizard', 'blastoise');
  await stage.runCommand('workbench.action.files.save');
}
