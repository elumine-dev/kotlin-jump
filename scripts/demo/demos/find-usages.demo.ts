import { Stage } from '../lib/stage';

/**
 * Demo: Find Usages — one keystroke surfaces every implementor and call-
 * site of a Kotlin symbol, scoped to your source; one more jump lands
 * you on the exact line that uses it.
 *
 * Target: `release()` on `PokemonRepository`. The demo workspace ships
 * a realistic Android / MVVM stack with:
 *   - 1 interface declaration               (PokemonRepository.kt)
 *   - 6 concrete implementations            — full Strategy/Decorator
 *   - 1 decorator call-through              (CachedPokemonRepository)
 *   - 1 ViewModel call site                 (PokedexViewModel)
 *
 * Narrative: Setup → Action (panel opens) → WOW (land on the VM call
 * site) → Relief. ~10 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: interface, cursor precisely on the `release` method.
  await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 31, column: 16 },
  );
  await stage.caption('release() on the Pokémon Repository interface', { duration: 1800 });

  // Action: Alt+F7 triggers Find Usages. Prime-then-result rhythm.
  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages');
  await stage.pause(1500);  // tree builds + panel renders
  await stage.caption('9 references across 8 files', { duration: 1800 });

  // WOW: jump to one of the call sites — the ViewModel consumer of the
  // repository. This is the moment that sells Find Usages: you don't just
  // see the list, you land on the exact line in one more keystroke.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexViewModel.kt',
    { line: 14, column: 19 },
  );
  await stage.caption('Jump to any usage in one click', { duration: 2500 });
}
