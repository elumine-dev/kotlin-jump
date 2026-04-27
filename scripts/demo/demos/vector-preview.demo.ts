import { Stage } from '../lib/stage';

/**
 * Demo: hover the <vector> tag in a drawable XML to preview the
 * rendered SVG. ~12 s.
 *
 * Story: an Android dev opens `res/drawable/ic_banner.xml`, sees the
 * raw <path> data, and wonders what it actually looks like. Hovering
 * the <vector> opening tag pops up a 256×256 SVG render of the
 * vector — no Android Studio, no preview pane, no rebuild.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Setup ──────────────────────────────────────────────────────────
  // ic_banner.xml is the canonical fixture: a non-square 240×80 vector
  // that exercises the SVG path conversion + viewport handling.
  await stage.openFile(
    'src/main/res/drawable/ic_banner.xml',
    { line: 20, column: 1 },  // 0-indexed: <vector at file line 21 (1-idx)
  );
  await stage.dwellOn({ line: 20, column: 1 }, 1000);
  await stage.caption('XML brut. Tu vois des <path> data, pas une image.', {
    duration: 2400,
  });

  // ── Trigger the hover via the underlying command ───────────────────
  // VS Code's `editor.action.showHover` opens the hover popup at the
  // current cursor position. The recorder doesn't simulate a real
  // mouse hover — invoking the command produces the same UI.
  await stage.runCommand('editor.action.showHover');
  await stage.pause(2000);  // hover + image render
  await stage.caption('Survole `<vector>` → vignette SVG rendue.', {
    duration: 2600,
  });

  await stage.pause(1500);
  await stage.caption('Aucun rebuild. Aucun Android Studio. ⚡', {
    duration: 2600,
  });
}
