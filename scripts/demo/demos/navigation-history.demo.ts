import { Stage } from '../lib/stage';

/**
 * Demo: Navigation History (Back / Forward).
 *
 * WOW moment: `Cmd+Opt+←` restores the ORIGINAL line AND column, not just
 * the file — matching Android Studio / IntelliJ, unlike plain VS Code's
 * "Go Back" which only remembers the file.
 *
 * Structure follows the playbook Setup → Action → WOW → Relief (~8 s total).
 *
 * Rhythm choices:
 *   - Setup uses `click()` — banner primes the viewer ("here comes Go to
 *     Definition"), then the navigation confirms.
 *   - WOW (Navigate Back/Forward) uses `navigate()` — the cursor jumps
 *     FIRST with the pulse-and-dim focus, and the banner reveals the
 *     shortcut immediately after. "What just happened? Oh — THAT key."
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  // Tabs are shown automatically once a second editor opens (fixture uses
  // showTabs: "multiple"), no explicit opt-in needed.

  // Setup: start on the override of fetchUser.
  await stage.openFile('src/main/kotlin/com/example/data/ApiServiceImpl.kt', { line: 4, column: 25 });
  await stage.caption('Start on the fetchUser override');

  // Action: Cmd+Click jumps up to the interface declaration.
  await stage.click('fetchUser', { modifier: 'Cmd', label: 'Go to Definition' });
  await stage.waitForEditor('ApiService.kt', 3);

  // WOW: Navigate Back. Cursor jumps back FIRST (with focus pulse), banner
  // reveals the shortcut right after — "that was ⌘+⌥+← Navigate Back".
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'ApiServiceImpl.kt', line: 4 },
  });

  // Relief: name why this matters.
  await stage.caption('Back restores the original line AND column');

  // Bonus: Navigate Forward completes the round-trip, same result-first rhythm.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + →',
    label:       'Navigate Forward',
    command:     'kotlinJump.navigateForward',
    awaitEditor: { file: 'ApiService.kt', line: 3 },
  });
}
