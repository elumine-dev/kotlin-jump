import { Stage } from '../lib/stage';

/**
 * Demo: Hex Color Swatches — every hex literal in the code gets an
 * inline color swatch, and clicking the swatch opens VS Code's native
 * Color Picker (which writes the new hex back into the source).
 *
 * Story: a dev opens a theme palette file. Every `0xFF7F52FF` and
 * `"#B00020"` shows a tiny coloured square inline. The viewer can SEE
 * the palette while reading the code — no hover, no separate preview
 * file.
 *
 * WOW: native VS Code shows hex swatches only for CSS files. Kotlin
 * Jump implements `DocumentColorProvider` for Kotlin/Java with both
 * Android `0xAARRGGBB` (8-digit ARGB) AND CSS-style `"#RRGGBB"` /
 * `"#AARRGGBB"` formats. And clicking a swatch opens the picker; the
 * value updates LIVE in the source.
 *
 * Narrative: Setup (open the palette file) → Reveal (caption naming
 * the swatches) → Scroll (down through more colour formats —
 * 0xAARRGGBB, "#RRGGBB", "#RGB" shorthands) → Relief. ~10 s. Pure
 * ambient — the rendering is the wow.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: open ThemeColors at line 21 (1-idx) = line 20 (0-idx) =
  // first 0xFF7F52FF (the Kotlin signature violet). Viewport shows
  // the whole "0xAARRGGBB" block — every line has a swatch.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/ThemeColors.kt',
    { line: 20, column: 0 },
  );
  // Long pause: the palette is dense (11 swatches in the viewport at
  // once). Eye needs ~3 s to scan all the colours and register the
  // pattern.
  await stage.pause(3000);

  // Question + callout: arrow points at the first swatch (column 22 =
  // just after the literal `0xFF7F52FF` on line 20). The viewer's eye
  // locks on the swatch while the caption asks the question.
  // Past EOL (line is 72 chars incl. `// ■ violet Kotlin`). Col 53 used
  // to land mid-whitespace between `))` and the comment — the callout
  // rendered in dead space instead of aligned with the swatch.
  void stage.calloutAt({ line: 20, column: 72 }, 'swatch', 2400);
  await stage.caption('What colours are in this palette?', {
    duration: 2800,
  });

  // Scroll slowly down through the file: 0xAARRGGBB block → "#RRGGBB"
  // strings → "#RGB" shorthand → Pokémon types. Each section uses a
  // different format; the viewer's eye learns "all of these formats
  // get swatches".
  // 40 lines / 4000 ms = 10 lines/s — slow enough that each format
  // section gets ~1 s of viewport time.
  await stage.scrollThrough({
    fromLine:   20,
    toLine:     63,
    column:     4,
    durationMs: 4000,
  });
  await stage.dwellOn({ line: 63 }, 1500);

  // Bonus beat: prove the clicking-a-swatch promise by actually
  // opening VS Code's native Color Picker. Scroll back up to the
  // first 0xFF7F52FF on line 20, park the caret INSIDE the hex literal
  // (column 34 lands in the middle of `0xFF7F52FF` which spans c32-c41),
  // then trigger `editor.action.showHover`. Since the cursor sits
  // inside a DocumentColorProvider-managed range, the hover popup
  // contains the color picker panel (swatch + RGB/HSL sliders).
  await stage.scrollThrough({
    fromLine:   63,
    toLine:     20,
    column:     34,
    durationMs: 2200,
  });
  await stage.dwellOn({ line: 20, column: 34 }, 900);
  await stage.caption('Click the swatch. Native Color Picker. 🎨', {
    duration: 2400,
  });
  await stage.runCommand('editor.action.showHover');
  // Hold the picker visible long enough for the viewer to read the
  // hex value, spot the swatch, and realise the sliders are live.
  // ~4 s = ~48 WebP frames at 12 fps — more than enough.
  await stage.pause(4200);
  await stage.caption('Drag a slider. The hex rewrites itself, live.', {
    duration: 2800,
  });
  // Dismiss the hover so the final frame isn't cluttered.
  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});
  await stage.pause(600);

  // Answer caption — declarative + bonus value (the live picker edit).
  await stage.caption('Every hex. Swatch inline. Picker one click away.', {
    duration: 2800,
  });
}
