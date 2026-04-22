import { Stage } from '../lib/stage';

/**
 * Demo: KDoc on hover for library symbols — hover any third-party
 * function and Kotlin Jump shows the KDoc extracted from the
 * matching `-sources.jar`.
 *
 * Story: a dev reads `withContext(Dispatchers.IO) { ... }` and
 * wonders what `withContext` actually does. Hover on the symbol
 * and the official kotlinx.coroutines KDoc renders in the panel —
 * no docs site, no IntelliJ, no LSP. Same for any indexed library
 * (junit, AndroidX, Retrofit, Compose if cached).
 *
 * WOW: documentation is a hover away for ANY indexed lib symbol.
 * The KDoc is extracted from the source JAR by `SignatureReader`
 * and rendered as Markdown.
 *
 * **Recording prerequisite**: `kotlinx-coroutines-core-jvm-X-sources.jar`
 * must be in `~/.gradle/caches/modules-2/files-2.1/`. Run
 * `./scripts/demo/setup-fixture.sh` once to materialise it.
 *
 * Narrative: Setup (cursor on `withContext`) → Action (Cmd+K Cmd+I →
 * Show Hover) → WOW (KDoc panel renders) → Relief. ~10 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: JarNavigationDemo line 17 (1-idx) = line 16 (0-idx) =
  // `val count = withContext(Dispatchers.IO) {`. Column 24 lands on
  // the `w` of `withContext`.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/JarNavigationDemo.kt',
    { line: 16, column: 24 },
  );
  await stage.dwellOn({ line: 16, column: 24 }, 900);
  await stage.caption('What does `withContext` actually do?', { duration: 2200 });

  // Action: trigger the hover. `editor.action.showHover` is VS Code's
  // built-in Cmd+K Cmd+I — same panel as a mouse hover, deterministic.
  await stage.keystroke('⌘ + K  ⌘ + I', { label: 'Show Hover' });
  await stage.runCommand('editor.action.showHover');
  // 3 s pause: the hover panel needs to render AND the viewer needs
  // to read the KDoc (multiple paragraphs typical for stdlib funcs).
  await stage.pause(3000);

  await stage.caption('KDoc straight from the JAR. No docs site. No LSP. 📖', {
    duration: 2800,
  });
}
