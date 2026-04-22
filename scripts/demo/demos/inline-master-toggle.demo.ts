import { Stage } from '../lib/stage';

/**
 * Demo: Inline-features master toggle — one button in the editor
 * toolbar flips ALL inline visualisations off (or back on).
 *
 * Story: a dev opens a file dense with hex color swatches. Wants to
 * see the raw code for a moment (review, search-and-replace, screen
 * share). One click → all ■ swatches vanish. Click again → they all
 * come back. Asymmetric semantics: any-on → all-off, all-off → all-on.
 *
 * WOW: the entire viewport visibly transforms. ~11 colored squares
 * disappear in a single frame, then reappear. No settings, no restart.
 *
 * Narrative: Setup (open ThemeColors, dwell on swatches) → caption →
 * Click master → all ■ gone → caption → Click again → all ■ back →
 * caption. ~13 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: ThemeColors.kt — 11 dense hex-color swatches in the
  // viewport. Centered at line 25 (0-idx) so the whole `0xAARRGGBB`
  // block (lines 20-30) sits in view. Each `Color(0x…)` line gets a
  // ■ swatch decoration that toggles with `hexColorSwatch`.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/ThemeColors.kt',
    { line: 25, column: 4 },
  );
  await stage.pause(900);

  // Move the cursor across three swatch lines so the viewer's eye
  // tracks where the change will happen. Without this the cursor
  // sits frozen for ~12 s and the demo reads as static.
  await stage.dwellOn({ line: 20, column: 30 }, 700);
  await stage.dwellOn({ line: 24, column: 30 }, 700);
  await stage.dwellOn({ line: 28, column: 30 }, 700);

  await stage.caption('Eleven hex swatches. ■ everywhere.', {
    duration: 2400,
  });

  // Click the $(layers) master button. The command flips every
  // kotlinJump inline-feature setting to OFF (since at least one is
  // currently ON). All ■ decorations vanish in a single frame.
  await stage.clickLens(
    '$(layers) → Toggle All Inline Features',
    'kotlinJump.toggleAllInlineFeatures',
  );
  await stage.pause(1200);
  await stage.caption('Master off. Pure code, ready to review or screenshot. 📸', {
    duration: 2800,
  });

  // Click again: every feature was OFF, so the master flips them
  // back to ON. Every ■ swatch reappears.
  await stage.clickLens(
    '$(layers) → Toggle All Inline Features',
    'kotlinJump.toggleAllInlineFeatures',
  );
  await stage.pause(1200);
  await stage.caption('Master on. All swatches back. One button. Both ways. 🔄', {
    duration: 2800,
  });
}
