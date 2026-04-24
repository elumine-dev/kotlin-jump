import { Stage } from '../lib/stage';

/**
 * Demo: @Suppress / @SuppressLint / @SuppressWarnings — hover any ID
 * and see a plain-English explanation of what the warning means.
 *
 * Why it matters: `@Suppress("UNCHECKED_CAST")` scattered through a
 * codebase is often copy-pasted without anyone remembering what each
 * one suppresses. Kotlin Jump now ships a dictionary of ~40 common
 * Kotlin / Android Lint / javac suppression IDs with short explanations
 * and doc links — hover the string, see the meaning.
 *
 * Fixture: `AnnotationsDemo.kt` already contains a variety of
 * `@Suppress(...)` patterns (Kotlin IDs, multi-arg lists, nested class
 * members, `@SuppressLint` too). No extra setup needed.
 *
 * The actual hover tooltip only appears on mouse hover — in a scripted
 * recording we simulate it with `calloutAt` anchors that show the text
 * at the position where the hover would pop up. A real user hovering
 * in VS Code sees the full markdown with description + doc link.
 *
 * ~12 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: land on a typical @Suppress ─────────────────────────────
  // AnnotationsDemo.kt line 39 (0-idx) = 40 (1-idx):
  //   `@Suppress("UNCHECKED_CAST")`
  await stage.openFile(
    'src/main/kotlin/com/example/demo/AnnotationsDemo.kt',
    { line: 38, column: 10 },
  );
  await stage.dwellOn({ line: 38, column: 10 }, 1200);
  await stage.caption('Every `@Suppress` silences a specific warning. Remember what?', {
    duration: 2600,
  });

  // ── Beat 2: the hover appears with the description ──────────────────
  // Simulate the hover with a calloutAt anchor: the renderer draws the
  // label next to the line, just like the hover tooltip would appear
  // above the cursor.
  void stage.calloutAt(
    { line: 38, column: 34 },
    'UNCHECKED_CAST — Cast to a generic type the runtime cannot verify',
    2800,
  );
  await stage.caption('Hover the ID. Plain-English description + doc link.', {
    duration: 2600,
  });

  // ── Beat 3: multi-arg @Suppress — every ID is hoverable ─────────────
  // Line 57 (0-idx) = 58 (1-idx):
  //   `@Suppress("UNCHECKED_CAST", "unused", "DEPRECATION")`
  // Each of the three strings is independently hoverable.
  await stage.scrollThrough({
    fromLine:   38,
    toLine:     57,
    column:     4,
    durationMs: 1400,
  });
  await stage.dwellOn({ line: 57, column: 4 }, 800);
  await stage.caption('Multi-arg? Every ID is hoverable on its own.', {
    duration: 2400,
  });

  // ── Beat 4: Android Lint IDs work too ───────────────────────────────
  // Note: the fixture has `@Suppress` examples with Kotlin IDs. In real
  // Android code, `@SuppressLint("MissingPermission")` / `("NewApi")`
  // resolve through the same provider to the Android Lint category.
  await stage.caption('Works for Kotlin, Android Lint, and `@SuppressWarnings` too.', {
    duration: 2600,
  });
}
