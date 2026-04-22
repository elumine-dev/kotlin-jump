import { Stage } from '../lib/stage';

/**
 * TEST DEMO — MutableStateFlow (kotlinx.coroutines.flow).
 *
 * Exercises the KMP expect/actual fix on a DIFFERENT symbol than `runBlocking`.
 * `MutableStateFlow` is an interface declared in `commonMain/flow/StateFlow.kt`.
 *
 * Disposable — to be deleted after validation.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 7, column: 22 },
  );

  await stage.openFile(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 7, column: 22 },
  );
  await stage.dwellOn({ line: 7, column: 22 }, 1100);
  await stage.caption('Where is `MutableStateFlow` defined?', { duration: 2200 });

  await stage.click('MutableStateFlow', {
    modifier: 'Cmd',
    label:    'Go to Definition (in kotlinx-coroutines JAR)',
  });
  await stage.waitForEditor('StateFlow.kt', undefined, 8000);
  await stage.pause(1500);

  await stage.caption('Inside `StateFlow.kt`. JAR navigation ✓', { duration: 2400 });
}
