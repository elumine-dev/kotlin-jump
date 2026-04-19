import { Stage } from '../lib/stage';

/**
 * Demo: Find Usages — the panel that surfaces every implementor and
 * call-site of a Kotlin symbol in one keystroke, scoped to your source
 * (no tests, no generated code).
 *
 * Target: `release()` on `PokemonRepository`. The demo workspace ships
 * a realistic Android / MVVM stack with:
 *   - 1 interface declaration               (PokemonRepository.kt)
 *   - 6 concrete implementations            — full Strategy/Decorator
 *     Network / Cached / Offline / InMemory / Fake / Impl
 *   - 1 decorator call-through              (CachedPokemonRepository)
 *   - 1 ViewModel call site                 (PokedexViewModel)
 *
 * Nine references across eight files — exactly the shape a real Kotlin
 * dev encounters when refactoring a repository. Alt+F7 surfaces them
 * all in one tree.
 *
 * Target duration: ~10 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: open the interface, cursor precisely on the `release` method.
  // Line 31 (0-indexed) = the 32nd line: `    suspend fun release(pokemon: Pokemon)`
  // Column 16 lands on the `r` of `release` (4 spaces + "suspend fun ").
  await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 31, column: 16 },
  );
  await stage.caption('release() on the Pokémon Repository interface', { duration: 2000 });

  // Action: Alt+F7 triggers Find Usages. Prime-then-result rhythm —
  // the banner names the shortcut BEFORE the panel arrives, so the
  // viewer anticipates "ok, something is about to be listed".
  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages');
  await stage.pause(1800);  // tree view builds + panel renders

  // WOW: the panel is now packed with references grouped by file.
  await stage.caption('9 references across 8 files — in one keystroke', { duration: 2500 });

  // Relief: Kotlin Jump's unique selling point over native Find References.
  await stage.caption('Scoped to Kotlin source — no tests, no generated noise', { duration: 2500 });
}
