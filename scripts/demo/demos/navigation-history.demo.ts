import { Stage } from '../lib/stage';

/**
 * Demo: Navigation History.
 *
 * Story: a dev is exploring the Pokédex codebase — scrolling around a
 * Compose screen, then dropping into the SQL DAO to check a query.
 * Six cursor stops across two files. Then: a single ⌘+⌥+← unwinds the
 * whole trail, line + column intact at every step.
 *
 * WOW: VS Code's native "Go Back" only remembers files, not positions.
 * Kotlin Jump restores the EXACT caret location — including a mid-file
 * hop that plain VS Code would collapse.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── File 1 — UI layer. Three stops: class decl, displayCard, battle result.
  await stage.openFile('src/main/kotlin/com/example/ui/PokedexScreen.kt', { line: 7,  column: 6 });
  await stage.caption('Poking around the Pokédex screen…', { duration: 1400 });

  await stage.openFile('src/main/kotlin/com/example/ui/PokedexScreen.kt', { line: 29, column: 12 });
  await stage.pause(600);

  await stage.openFile('src/main/kotlin/com/example/ui/PokedexScreen.kt', { line: 54, column: 12 });
  await stage.pause(600);

  // ── File 2 — data layer. Three stops: simple SELECT, JOIN, EXISTS.
  await stage.openFile('src/main/kotlin/com/example/data/PokemonDao.kt', { line: 21, column: 8 });
  await stage.caption('…and into the DAO', { duration: 1400 });

  await stage.openFile('src/main/kotlin/com/example/data/PokemonDao.kt', { line: 67, column: 8 });
  await stage.pause(600);

  await stage.openFile('src/main/kotlin/com/example/data/PokemonDao.kt', { line: 135, column: 8 });
  await stage.pause(800);

  // ── Retrace. First press announces the shortcut; the next three
  //    fire silently — we want the viewer to feel the trail unwind.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'PokemonDao.kt', line: 67 },
    duration:    1500,
  });

  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('PokemonDao.kt', 21);
  await stage.pause(400);

  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('PokedexScreen.kt', 54);
  await stage.pause(400);

  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('PokedexScreen.kt', 29);

  await stage.caption('Exact line, exact column — at every stop', { duration: 2500 });
}
