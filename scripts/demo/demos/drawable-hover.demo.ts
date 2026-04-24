import { Stage } from '../lib/stage';

// Total budget for the progress bar — must stay in sync with the sum
// of dwells + captions + scrolls + callouts below. The orchestrator
// reads this value at start-up to size its `[███░░░] X.Ys/N.Ns` bar.
export const estimatedDurationMs = 10_600;

/**
 * R.drawable hover preview + gutter thumbnails.
 *
 * Every `R.drawable.xxx` reference paints a miniature in the gutter;
 * hovering the name pops a 128-px SVG preview with path and variants.
 *
 * ~10 s.
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
