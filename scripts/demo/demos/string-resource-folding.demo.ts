import { Stage } from '../lib/stage';

/**
 * Demo: String Resource Folding + Go to Definition + locale hop.
 *
 * Four beats:
 *   1. Folded values — `R.string.*` keys render as the actual text,
 *      so the call sites read like the rendered UI.
 *   2. Cursor on a folded line — the key comes back for editing.
 *   3. Cmd+Click on the key — jumps to `values/strings.xml`.
 *   4. Open `values-fr/strings.xml` for the same key — shows the
 *      translated value. Multilingual navigation without leaving
 *      the editor.
 *
 * ~15 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Folded values on a dense block ──────────────────────────
  // InlayHintsDemo.kt line 49 (0-idx) = `fun demoStringFolding() {`.
  // Cursor on the header — NOT on a folded line — so every R.string.*
  // in the body (lines 51+) shows its actual translated value.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 49, column: 0 },
  );
  await stage.pause(2200);
  await stage.caption('Looks like English UI text. But it’s all R.string keys.', {
    duration: 2400,
  });

  // ── Beat 2: Cursor on the line — key returns ────────────────────────
  // Line 51 (0-idx) = `val screenTitle = R.string.title_pokedex`.
  // `title_pokedex` spans cols 22-34. Col 26 is inside the word so
  // the folding provider lifts the overlay for THIS line only.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/InlayHintsDemo.kt',
    { line: 51, column: 26 },
  );
  await stage.dwellOn({ line: 51, column: 26 }, 900);
  await stage.caption('Cursor on a line, the key returns. Edit, then move on. ✍️', {
    duration: 2600,
  });

  // ── Beat 3: Cmd+Click → values/strings.xml ──────────────────────────
  // Target `title_pokedex` — kotlin-jump's StringResourceDefinition
  // Provider routes straight to `<string name="title_pokedex">…` in
  // the default locale file.
  await stage.click('title_pokedex', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  await stage.waitForEditor('values/strings.xml');
  await stage.pause(1200);
  await stage.caption('One click, you land in values/strings.xml. 🎯', {
    duration: 2400,
  });

  // ── Beat 4: Multilingual hop — same key in values-fr ────────────────
  // `title_pokedex` at line 7 (0-idx) of the French strings file.
  await stage.openFile(
    'src/main/res/values-fr/strings.xml',
    { line: 7, column: 0 },
  );
  await stage.dwellOn({ line: 7 }, 900);
  await stage.caption('Same key, French version. 🇫🇷 Zero translation hunt.', {
    duration: 2800,
  });
}
