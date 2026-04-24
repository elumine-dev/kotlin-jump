import { Stage } from '../lib/stage';

// Total budget for the progress bar — must stay in sync with the sum
// of dwells + captions + scrolls + callouts below. The orchestrator
// reads this value at start-up to size its `[███░░░] X.Ys/N.Ns` bar.
export const estimatedDurationMs = 10_600;

/**
 * Demo: R.drawable.xxx — rich hover preview + gutter thumbnails.
 *
 * Two user-facing features live in one scene:
 *
 *   1. **Gutter thumbnail** — every `R.drawable.xxx` reference paints
 *      a tiny rendering of the asset in the editor gutter. Scanning
 *      a file becomes spatial instead of textual; your eye sees which
 *      icon goes where without reading a single name.
 *
 *   2. **Rich hover** — hovering the drawable name pops a tooltip
 *      with a 128-px SVG render, the full res-qualifier path, and
 *      a list of every density / -night / -v24 variant that ships
 *      alongside the default one.
 *
 * Fixture: `DrawableResourceDemo.kt` references five vector XMLs:
 * `ic_pokeball`, `ic_type_fire`, `ic_type_water`, `ic_type_grass`,
 * `ic_type_electric`. Enough variety that the viewer can see the
 * gutter column populate with distinct thumbnails, then watch the
 * hover pop a full-size preview per drawable.
 *
 * ~10 s (budget aligned with suppress-hover 13 s / code-lens 10 s —
 * the repo norm for hover-style demos). Three beats + closer is the
 * maximum density before the viewer's eye gives up on the captions.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Positions vérifiées au caractère près contre le fixture ────────
  //   File 18  `val APP_ICON       = R.drawable.ic_pokeball`      → API line 17 · len 43
  //   File 20  `val TYPE_WATER     = R.drawable.ic_type_water`    → API line 19 · len 45
  //   File 22  `val TYPE_ELECTRIC  = R.drawable.ic_type_electric` → API line 21 · len 48
  // Callout ANCHORS at end-of-line so the `after` decoration extends
  // RIGHT of the source — never overlapping the code.

  // ── Beat 1: open, let the gutter populate ───────────────────────────
  await stage.openFile(
    'src/main/kotlin/com/example/demo/DrawableResourceDemo.kt',
    { line: 17, column: 37 },
  );
  await stage.dwellOn({ line: 17, column: 37 }, 1000);
  await stage.caption('Every `R.drawable.*` → thumbnail in the gutter.', {
    duration: 1800,
  });

  // ── Beat 2: scan the five top-level vals (thumbnails per line) ──────
  await stage.scrollThrough({
    fromLine:   17,
    toLine:     21,
    column:     32,
    durationMs: 1600,
  });
  await stage.caption('Five types · five icons.', {
    duration: 1800,
  });

  // ── Beat 3: single hover demonstration — ic_type_water (middle row) ─
  //          One hover is enough; the viewer already saw gutter coverage
  //          in Beat 2. Second/third hovers would over-explain.
  //          Dwell at 600 ms so the flashClickSource halo is clearly
  //          perceived before the callout pops.
  await stage.dwellOn({ line: 19, column: 38 }, 600);
  void stage.calloutAt(
    { line: 19, column: 45 },
    '💧 ic_type_water.xml',
    2200,
  );
  await stage.caption('Hover → SVG preview + path + variants.', {
    duration: 2200,
  });

  // ── Closer ──────────────────────────────────────────────────────────
  await stage.caption('Gutter for orientation · hover for detail.', {
    duration: 1600,
  });
}
