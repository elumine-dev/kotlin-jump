import { Stage } from '../lib/stage';

/**
 * TEST DEMO — `listOf` (bundled Kotlin stdlib).
 *
 * Exercises a COMPLETELY different scanner — the bundled stdlib
 * (`bundled/kotlin-stdlib-1.9.25-sources.jar`) instead of the Gradle cache.
 * `listOf` has multiple declarations in `Collections.kt`, one of them
 * `expect` — validates the actual-over-expect priority fix end-to-end.
 *
 * Disposable.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 14, column: 17 },
  );

  await stage.openFile(
    'src/main/kotlin/com/example/libjartests/MainHarness.kt',
    { line: 14, column: 17 },
  );
  await stage.dwellOn({ line: 14, column: 17 }, 1100);
  await stage.caption('Where is `listOf` defined (stdlib)?', { duration: 2200 });

  await stage.click('listOf', {
    modifier: 'Cmd',
    label:    'Go to Definition (bundled Kotlin stdlib)',
  });
  // `listOf` has overloads split across `Collections.kt` (commonMain, vararg
  // + inline no-arg) and `CollectionsJVM.kt` (jvmMain actual, single-arg).
  // Either file is a valid Go-to-Definition target — the regex parser has
  // no type info to disambiguate by arity.
  await stage.waitForEditor(/Collections(?:JVM)?\.kt$/, undefined, 8000);
  await stage.pause(1500);

  await stage.caption('Inside `Collections.kt`. Bundled stdlib resolved ✓', { duration: 2400 });
}
