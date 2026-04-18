import { Stage } from '../lib/stage';

/**
 * Demo: Navigation History (Back / Forward).
 *
 * Shows how Kotlin Jump preserves cursor position across cross-file jumps,
 * mirroring the Android Studio `Cmd+Opt+Left / Right` workflow.
 *
 * Target duration: ~12 seconds.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // 1. Start from the ApiServiceImpl override of fetchUser.
  await stage.openFile('src/main/kotlin/com/example/data/ApiServiceImpl.kt', { line: 4, column: 25 });
  await stage.caption('Start on the fetchUser override', { duration: 1500 });

  // 2. Cmd+Click → Go to Definition jumps up to the interface declaration.
  await stage.click('fetchUser', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  await stage.waitForEditor('ApiService.kt', 3);
  await stage.pause(1200);

  // 3. Use the keyboard shortcut to go back to the override.
  await stage.keystroke('⌘ + ⌥ + ←', { label: 'Navigate Back' });
  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('ApiServiceImpl.kt', 4);
  await stage.pause(600);

  // 4. Explain what's special about this.
  await stage.caption('Back restores the original line AND column', { duration: 2200 });

  // 5. And forward to return to the interface.
  await stage.keystroke('⌘ + ⌥ + →', { label: 'Navigate Forward' });
  await stage.runCommand('kotlinJump.navigateForward');
  await stage.waitForEditor('ApiService.kt', 3);
  await stage.pause(1200);
}
