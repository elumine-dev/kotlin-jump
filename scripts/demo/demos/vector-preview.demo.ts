import { Stage } from '../lib/stage';

/**
 * Demo: open a `<vector>` drawable, watch the side panel auto-open
 * beside the source, then live-edit a colour and see the preview
 * redraw without leaving the editor. ~16 s.
 *
 * Story: an Android dev opens `res/drawable/ic_pokeball.xml`, sees
 * the rendered Pokéball pop in beside the XML, tweaks one colour,
 * the preview catches up in ~120 ms — no rebuild, no Android Studio.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Setup ──────────────────────────────────────────────────────────
  // Land the cursor on the <vector> opening line so the auto-side-
  // preview activates immediately and the CodeLens above is visible.
  await stage.openFile(
    'src/main/res/drawable/ic_pokeball.xml',
    { line: 13, column: 0 },
  );
  await stage.pause(900); // let the side panel slide in
  await stage.caption('Open a vector → preview pops in beside it.', {
    duration: 2400,
  });

  // ── Beat 2: live colour edit ───────────────────────────────────────
  // Change the red top half (#EE1515) to a Pokémon-blue tone. The
  // side preview catches up after the 120 ms debounce — short enough
  // that the recording shows code + preview moving together.
  // Lines are 0-indexed in the API: file line 22 = stage line 21.
  await stage.replaceText(21, '#EE1515', '#3B4CCA');
  await stage.pause(500); // preview redraws within ~120 ms
  await stage.caption('Edit a colour → preview redraws live. ⚡', {
    duration: 2600,
  });

  // ── Beat 3: second edit, drive the point home ──────────────────────
  // File line 42 (inner white) → 0-indexed line 41.
  await stage.replaceText(41, '#FFFFFF', '#FBE13E');
  await stage.pause(500);
  await stage.caption('Every keystroke. No rebuild.', {
    duration: 2400,
  });

  // ── Beat 4: closer ─────────────────────────────────────────────────
  await stage.pause(800);
  await stage.caption('Vector + live preview, side by side. 🎨', {
    duration: 2600,
  });
}
