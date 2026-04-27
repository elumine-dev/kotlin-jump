import { Stage } from '../lib/stage';

/**
 * Demo: vector preview, end-to-end. ~22 s.
 *
 * Story arc:
 *   1. A Kotlin file references `R.drawable.ic_pokeball`.
 *   2. Cmd+Click on the name → land in `ic_pokeball.xml`. The side
 *      preview slides in beside the source the moment the file
 *      becomes active.
 *   3. Edit a hex literal (the way a dev would by clicking VS Code's
 *      built-in colour swatch and picking a new colour). The preview
 *      catches up live.
 *   4. Close the preview — the CodeLens above `<vector>` is the
 *      one-click way back. Click it to re-open.
 *   5. Hover the `<vector>` tag → 256×256 popup variant for a peek
 *      without re-opening the panel.
 *
 * Pokémon-themed colours: Great Ball blue (#3B4CCA), Master Ball
 * purple (#9333EA). Picked because they're instantly recognisable
 * Pokéball variants — the viewer reads "this is a Great Ball" /
 * "this is a Master Ball" without needing the caption to spell it.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: start in code, on the R.drawable reference ────────────
  // VisualBugsDemo.kt line 98 (1-idx) = line 97 (0-idx):
  //   `private val banner = R.drawable.ic_pokeball`
  // Land the cursor on `ic_pokeball` so Cmd+Click resolves to the XML.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/VisualBugsDemo.kt',
    { line: 97, column: 38 },
  );
  await stage.dwellOn({ line: 97, column: 38 }, 1000);
  await stage.caption('A reference to a vector drawable in code.', { duration: 2200 });

  // ── Beat 2: Cmd+Click → land in the XML ──────────────────────────
  await stage.click('ic_pokeball', { modifier: 'Cmd', label: 'Go to Definition' });
  await stage.waitForEditor('ic_pokeball.xml');
  await stage.pause(900); // side panel slides in
  await stage.caption('Cmd+Click → preview pops in beside the source.', { duration: 2400 });

  // ── Beat 3: live colour edit (mimics the VS Code colour picker) ──
  // The viewer can't see the picker UI in a recorded run, so we
  // narrate the gesture with the caption while replacing the literal.
  // Top half #EE1515 (Poké Ball red) → #3B4CCA (Great Ball blue).
  await stage.replaceText(21, '#EE1515', '#3B4CCA');
  await stage.pause(500); // 120 ms debounce + render
  await stage.caption('VS Code colour picker → Great Ball blue.', { duration: 2400 });

  // Centre red dot → Master Ball purple, just to drive home that any
  // edit redraws and to add a recognisable second beat.
  await stage.replaceText(46, '#EE1515', '#9333EA');
  await stage.pause(500);
  await stage.caption('Master Ball purple — every edit redraws live.', { duration: 2400 });

  // ── Beat 4: close the preview, show CodeLens stays put ───────────
  await stage.runCommand('kotlinJump.vectorPreview.close');
  await stage.pause(700);
  await stage.caption('Close the preview…', { duration: 1800 });

  // ── Beat 5: hover the <vector> tag for the popup variant ─────────
  // 0-indexed line 13 (= file line 14: `<vector ...`).
  await stage.dwellOn({ line: 13, column: 1 }, 600);
  await stage.runCommand('editor.action.showHover');
  await stage.pause(1800);
  await stage.caption('No panel? Hover the tag for a quick peek.', { duration: 2400 });

  // ── Beat 6: re-open via the CodeLens command ─────────────────────
  await stage.runCommand('kotlinJump.vectorPreview.show');
  await stage.pause(900);
  await stage.caption('CodeLens above `<vector>` brings the panel back.', { duration: 2600 });

  await stage.pause(600);
  await stage.caption('Vector + live preview, exactly where you read code. 🎨', { duration: 2600 });
}
