import { Stage } from '../lib/stage';

/**
 * TEST DEMO — `Assert` (JUnit 4, pure Java).
 *
 * Exercises the Java parser path in a JAR — JUnit 4 `org.junit.Assert.java`.
 * Different from the existing `lib-jar-navigation` demo (JUnit 5 Jupiter).
 *
 * Disposable.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  await stage.waitForDefinition(
    'src/test/kotlin/com/example/libjartests/JUnit4Harness.kt',
    { line: 8, column: 10 },
  );

  await stage.openFile(
    'src/test/kotlin/com/example/libjartests/JUnit4Harness.kt',
    { line: 8, column: 10 },
  );
  await stage.dwellOn({ line: 8, column: 10 }, 1100);
  await stage.caption('Where is `Assert` defined (JUnit 4)?', { duration: 2200 });

  await stage.click('Assert', {
    modifier: 'Cmd',
    label:    'Go to Definition (in JUnit 4 JAR)',
  });
  await stage.waitForEditor('Assert.java', undefined, 8000);
  await stage.pause(1500);

  await stage.caption('Inside `org/junit/Assert.java`. Java JAR navigation ✓', { duration: 2400 });
}
