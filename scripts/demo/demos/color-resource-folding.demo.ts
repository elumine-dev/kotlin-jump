import { Stage } from '../lib/stage';

/**
 * Demo: R.color Inline Swatch — every `R.color.xxx` reference in
 * Kotlin code shows a coloured square inline (resolved from the
 * matching `<color>` definition in `res/values/colors.xml`).
 *
 * Three beats:
 *   1. Open + scroll — swatches appear next to every R.color reference.
 *   2. Multi-line selection over the `typeColor` when-block —
 *      kotlin-jump's ColorFoldingProvider detects the selection and
 *      LIFTS swatches on every overlapped line, so the raw
 *      `R.color.type_fire` / `_water` / `_grass` … names reappear,
 *      ready to edit. Other lines keep their swatches.
 *   3. Collapse selection — swatches return instantly.
 *
 * WOW: the swatches are not "baked in" decorations; they step aside
 * the instant you select text to edit. That's a quality-of-life
 * property most decoration-based features skip.
 *
 * Status bar is re-enabled so the viewer can spot "Kotlin Jump: Run
 * Android" item — a secondary signal that the extension is active.
 *
 * ~16 s total.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: open + ambient swatches ─────────────────────────────────
  // ColorResourceDemo.kt line 18 (0-idx) = line 19 (1-idx) = top-level
  // `val BRAND_PRIMARY = R.color.primary`. Each R.color.* in the
  // viewport gets a coloured square inline.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/ColorResourceDemo.kt',
    { line: 18, column: 0 },
  );
  await stage.pause(2400);
  // Past EOL (line is 37 chars: `val BRAND_PRIMARY   = R.color.primary`).
  // Col 22 used to land on `R` of `R.color`, splitting the identifier.
  void stage.calloutAt({ line: 19, column: 37 }, 'swatch', 2400);
  await stage.caption('So what do these R.colors actually look like?', {
    duration: 2800,
  });

  // Scroll through the variants — locals, interpolation, function
  // args. The swatch placement adapts to each context. Land near the
  // `typeColor` when-block so the multi-select beat below stays in
  // the same viewport (no extra scroll jitter).
  await stage.scrollThrough({
    fromLine:   18,
    toLine:     109,
    column:     4,
    durationMs: 3200,
  });
  await stage.dwellOn({ line: 109 }, 800);

  // ── Beat 2: multi-line selection lifts the swatches ──────────────────
  // typeColor block on line 110 (0-idx):
  //   line 110: `fun typeColor(type: PokemonType): Int = when (type) {`
  //   line 111-116: 6 branches, each with an R.color.type_* swatch
  //   line 117: `}`
  // Selecting lines 111..116 covers all 6 swatch lines at once.
  // ColorFoldingProvider's `revealedLines(selections)` skips these
  // lines — raw `R.color.type_fire` / `_water` / `_grass` / `_electric`
  // / `_psychic` / `_dragon` names become visible while everything
  // outside the selection keeps its swatch.
  await stage.caption('Select the lines. Swatches step aside for editing. ✍️', {
    duration: 2600,
  });
  await stage.selectLines(111, 116);
  // Hold: viewer reads the raw names and clocks the contrast with the
  // swatches still visible above (line 110 `when (type)`) and below.
  await stage.pause(2800);
  await stage.caption('Raw names are back. Swatches stay on every other line.', {
    duration: 2800,
  });

  // ── Beat 3: collapse selection, swatches return ──────────────────────
  // openFile with a point position drops the selection; the provider's
  // `onDidChangeTextEditorSelection` debounce (30 ms) re-renders the
  // swatches within one WebP frame.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/ColorResourceDemo.kt',
    { line: 110, column: 0 },
  );
  await stage.pause(1400);

  await stage.caption('Move on. Swatches snap back, straight from colors.xml. 🎨', {
    duration: 2800,
  });
}
