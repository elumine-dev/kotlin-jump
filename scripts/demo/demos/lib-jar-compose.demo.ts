import { Stage } from '../lib/stage';

/**
 * Demo: Library JAR navigation — Cmd+Click into Compose source.
 *
 * Story: a dev reads a `@Composable fun PokemonCard()` and Cmd+Clicks
 * on `Text` to read the actual Compose Material implementation. The
 * editor opens the source from inside Compose Multiplatform's
 * `material-X-sources.jar`, with full KDoc, signatures, and navigable
 * cross-references.
 *
 * **Recording prerequisite**: `org.jetbrains.compose.material:material-X-sources.jar`
 * must be in `~/.gradle/caches/modules-2/files-2.1/`. Run
 * `cd test/kotlin-jump-demo && ./gradlew dependencies` once to
 * materialise it (declared in `build.gradle.kts`).
 *
 * Narrative: Setup (cursor on `Text`) → Action (Cmd+Click) → WOW
 * (lands inside the Compose JAR) → Relief. ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  // The Compose JAR is indexed ASYNCHRONOUSLY after activation. Block
  // until `Text` resolves — otherwise the click below fires before the
  // symbol exists and throws "no definition found".
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/compose/JarNavigationComposeDemo.kt',
    { line: 24, column: 8 },
  );

  // Setup: JarNavigationComposeDemo line 25 (1-idx) = line 24 (0-idx) =
  // `Text(text = name)`. Column 8 lands on the `T` of `Text`.
  await stage.openFile(
    'src/main/kotlin/com/example/compose/JarNavigationComposeDemo.kt',
    { line: 24, column: 8 },
  );
  await stage.dwellOn({ line: 24, column: 8 }, 1100);
  await stage.caption('Where is `Text` actually implemented?', { duration: 2200 });

  // Action: Cmd+Click → resolves into Compose Material JAR.
  // Destination URI: `jar:file://~/.gradle/caches/.../org.jetbrains.compose.material/material-jvm-X-sources.jar
  // !/androidx/compose/material/Text.kt`. Match by file suffix only —
  // version varies.
  await stage.click('Text', {
    modifier: 'Cmd',
    label:    'Go to Definition (in Compose JAR)',
  });
  await stage.waitForEditor('Text.kt');
  await stage.pause(1500);

  await stage.caption('Inside Compose Material. KDoc, source, all yours. 📚', {
    duration: 2800,
  });
}
