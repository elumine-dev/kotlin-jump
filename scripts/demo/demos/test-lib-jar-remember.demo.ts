import { Stage } from '../lib/stage';

/**
 * TEST DEMO — `remember` (androidx.compose.runtime).
 *
 * Different KMP library than the main `Text` compose demo — tests the runtime
 * package (vs material) and a function with multiple `inline fun` overloads
 * in the same file (`commonMain/androidx/compose/runtime/Composables.kt`).
 *
 * Disposable.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 11, column: 20 },
  );

  await stage.openFile(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 11, column: 20 },
  );
  await stage.dwellOn({ line: 11, column: 20 }, 1100);
  await stage.caption('Where is `remember` defined?', { duration: 2200 });

  await stage.click('remember', {
    modifier: 'Cmd',
    label:    'Go to Definition (in Compose Runtime JAR)',
  });
  await stage.waitForEditor('Composables.kt', undefined, 8000);
  await stage.pause(1500);

  await stage.caption('Inside `Composables.kt`. Compose runtime resolved ✓', { duration: 2400 });
}
