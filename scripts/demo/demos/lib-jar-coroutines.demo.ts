import { Stage } from '../lib/stage';

/**
 * Demo: Library JAR navigation — Cmd+Click on `runBlocking` jumps
 * into the `kotlinx-coroutines-core-jvm-X-sources.jar` source.
 *
 * Story: a dev reads a coroutine bridge call (`runBlocking { … }`)
 * and Cmd+Clicks on `runBlocking` to read the actual definition.
 * The editor opens `Builders.kt` from inside the JAR with full KDoc
 * + signatures + navigable cross-references.
 *
 * Why `runBlocking` and not `Dispatchers` / `launch` / `withContext`?
 * The demo workspace ships local STUBS for those names in
 * `CoroutinesDemo.kt` (so other demos compile without pulling
 * Android Lifecycle deps). The regex resolver in this extension
 * indexes by simple name, so Cmd+Click on `Dispatchers` lands on
 * the local stub, not the JAR. `runBlocking` and `MutableStateFlow`
 * are NOT stubbed — the resolver finds only the JAR declaration
 * and navigates there cleanly.
 *
 * **Recording prerequisite**: `kotlinx-coroutines-core-jvm-X-sources.jar`
 * must be in `~/.gradle/caches/modules-2/files-2.1/`. Run
 * `./scripts/demo/setup-fixture.sh` once to materialise it.
 *
 * Narrative: Setup (cursor on `runBlocking`) → Action (Cmd+Click) →
 * WOW (lands inside Builders.kt with KDoc visible) → Relief. ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  // Wait for the coroutines JAR to be indexed (async scan after
  // activation). Without this, `runBlocking` resolves to nothing on
  // the first click attempt.
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/demo/JarNavigationDemo.kt',
    { line: 14, column: 33 },
  );

  // Setup: JarNavigationDemo line 15 (1-idx) = line 14 (0-idx) =
  //   `    fun loadInitial(): Int = runBlocking {`
  // Column 33 lands inside `runBlocking` (cols 29-39). Word range
  // resolves to the full identifier.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/JarNavigationDemo.kt',
    { line: 14, column: 33 },
  );
  await stage.dwellOn({ line: 14, column: 33 }, 1100);
  await stage.caption('Where is `runBlocking` actually defined?', { duration: 2200 });

  // Action: Cmd+Click → resolves into kotlinx-coroutines-core JAR.
  // Destination URI: `jar:file://~/.gradle/caches/.../kotlinx-coroutines-
  // core-jvm-X-sources.jar!/jvmMain/Builders.kt`. The KDoc block
  // for runBlocking starts at JAR line 12; the function declaration
  // is at line 49.
  await stage.click('runBlocking', {
    modifier: 'Cmd',
    label:    'Go to Definition (in kotlinx-coroutines JAR)',
  });
  await stage.waitForEditor('Builders.kt');
  await stage.pause(1500);

  await stage.caption('Inside kotlinx.coroutines. KDoc, source, all yours. 📚', {
    duration: 2800,
  });
}
