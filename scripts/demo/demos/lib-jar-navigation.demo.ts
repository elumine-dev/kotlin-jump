import { Stage } from '../lib/stage';

/**
 * Demo: Library JAR navigation — Cmd+Click on a third-party type
 * jumps INTO the source JAR (KDoc and all), no setup required.
 *
 * Story: a dev reads a JUnit test and Cmd+Clicks on `Test`. The
 * editor opens the actual `Test.java` source from inside
 * `junit-jupiter-api-X.Y.Z-sources.jar` — the same source you'd
 * see if you cloned the JUnit repo. KDoc, signatures, navigable
 * symbols, all there.
 *
 * WOW: zero "Attach Sources…" prompt. Kotlin Jump's
 * `GradleSourcesScanner` indexes every `-sources.jar` in your
 * Gradle cache (`~/.gradle/caches/modules-2/files-2.1`) at startup.
 * If the dependency is in your build.gradle.kts AND the sources
 * have been downloaded once, the jump just works.
 *
 * **Recording prerequisite**: `kotlinx-coroutines-core-sources.jar`
 * and/or `junit-jupiter-api-X-sources.jar` must be in
 * `~/.gradle/caches`. Run `cd test/kotlin-jump-demo && ./gradlew
 * build --refresh-dependencies` once if missing.
 *
 * Narrative: Setup (open a test file with junit imports) → Action
 * (Cmd+Click on `Test`) → WOW (lands inside the JAR source) →
 * Relief. ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  // Wait for the junit JAR to be indexed (async scan after activation).
  await stage.waitForDefinition(
    'src/test/kotlin/com/example/ui/UserViewModelTest.kt',
    { line: 10, column: 33 },
  );

  // Setup: UserViewModelTest.kt line 11 (1-idx) = line 10 (0-idx) =
  // `import org.junit.jupiter.api.Test`. Column 33 lands on the `T`
  // of `Test` so the click halo brackets the symbol.
  await stage.openFile(
    'src/test/kotlin/com/example/ui/UserViewModelTest.kt',
    { line: 10, column: 33 },
  );
  await stage.dwellOn({ line: 10, column: 33 }, 1100);
  await stage.caption('Where is `@Test` actually defined?', { duration: 2200 });

  // Action: Cmd+Click → resolves to junit-jupiter-api inside the JAR.
  // The destination URI is something like
  // `jar:file://~/.gradle/caches/.../junit-jupiter-api-X-sources.jar
  // !/org/junit/jupiter/api/Test.java`. We don't pin a line — the JAR
  // version may vary; matching by file suffix `Test.java` is enough.
  await stage.click('Test', {
    modifier: 'Cmd',
    label:    'Go to Definition (in JAR)',
  });
  await stage.waitForEditor('Test.java');
  await stage.pause(1500);

  await stage.caption('Inside the JAR. KDoc, signatures, all browsable. 🔍', {
    duration: 2800,
  });
}
