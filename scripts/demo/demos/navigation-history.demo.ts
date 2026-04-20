import { Stage } from '../lib/stage';

/**
 * Demo: Navigation History.
 *
 * Story: a dev explores a Compose screen, drops into the SQL DAO to
 * cross-check a query, then unwinds the whole trail with ⌘+⌥+← — one
 * press at a time, narrated. Finally ⌘+⌥+→ steps forward to show the
 * history works both directions.
 *
 * WOW: VS Code's native "Go Back" only remembers files, not positions.
 * Kotlin Jump restores the EXACT caret — including mid-file hops that
 * plain VS Code would collapse into one.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Forward: 2 stops per file, 2 files.
  // First stop: `fun render()` declaration (line 16, 1-idx = line 15, 0-idx).
  // The previous target (line 7, 0-idx = line 8, 1-idx was `class` decl but
  // the viewport center landed on the EMPTY line above — visually useless).
  // `render()` is a meaningful symbol: it anchors the "poking around the
  // Compose screen" caption to real UI code the viewer can read.
  await stage.openFile('src/main/kotlin/com/example/ui/PokedexScreen.kt', { line: 15, column: 8 });
  await stage.dwellOn({ line: 15, column: 8 }, 600);  // word halo on `render`
  await stage.caption('Poking around the Compose screen…', { duration: 1400 });

  // Same-file hop — scroll deliberately instead of teleporting the viewport.
  await stage.scrollThrough({ fromLine: 15, toLine: 29, column: 12 });
  await stage.dwellOn({ line: 29 }, 900);

  // Cross-file hop — tab change carries the visual cue, shorter dwell is fine.
  // Land on `fun getAll(): List<Pokemon>` (line 24, 1-idx = line 23, 0-idx).
  // Previous target (line 21, 0-idx = line 22, 1-idx) was an empty line just
  // under the section comment — visually useless. `getAll` is the first real
  // DAO method and anchors the "SQL DAO" narrative.
  await stage.openFile('src/main/kotlin/com/example/data/PokemonDao.kt', { line: 23, column: 8 });
  await stage.dwellOn({ line: 23, column: 8 }, 500);  // halo on `getAll`
  await stage.pause(600);

  // Same-file hop — step through so the motion reads.
  await stage.scrollThrough({ fromLine: 23, toLine: 67, column: 8 });
  await stage.dwellOn({ line: 67 }, 900);

  // ── Retrace, one press at a time. Every press emits its ⌘+⌥+← banner so
  //    the viewer sees the shortcut being pressed AGAIN at each step — the
  //    captions narrate "where we landed", the banner says "how we got
  //    here". Shorter banner duration (1100 ms) on repeats so three banners
  //    in a row don't feel shouty.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'PokemonDao.kt', line: 23 },
    duration:    1400,
  });
  await stage.pause(500);  // let the same-file scroll settle before caption
  await stage.caption('Back to the SELECTs — top of the DAO', { duration: 1600 });

  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'PokedexScreen.kt', line: 29 },
    duration:    1100,
  });
  await stage.pause(400);
  await stage.caption('Across files — back in displayCard', { duration: 1600 });

  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'PokedexScreen.kt', line: 15 },
    duration:    1100,
  });
  await stage.pause(500);  // same-file scroll up 22 lines — give it time
  await stage.caption('And the very first stop — class header', { duration: 1600 });

  // ── Forward: same history, opposite direction. One step is enough
  //    to make the point; we stop at displayCard instead of retracing
  //    all the way.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + →',
    label:       'Navigate Forward',
    command:     'kotlinJump.navigateForward',
    awaitEditor: { file: 'PokedexScreen.kt', line: 29 },
    duration:    1400,
  });
  await stage.caption('Forward works the same way — line AND column', { duration: 2000 });
}
