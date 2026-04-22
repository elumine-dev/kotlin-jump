import { Stage } from '../lib/stage';

/**
 * Demo: Override Gutter Icons — `⬇ N implementations` on every
 * abstract method, `⬆ overrides` on every concrete override.
 *
 * Less spectacular than Code Lens (similar visual idiom) but
 * complementary: shows the *direction* of inheritance at a glance.
 *
 * Narrative: open the interface (⬇ counts), scroll to an impl
 * (⬆ overrides). Pure ambient. ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Open PokemonRepository.kt — interface with 6 impls. Each abstract
  // method shows `⬇ N implementations` on its own gutter line.
  await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 15, column: 0 },
  );
  await stage.pause(2400);
  // Question caption — primes the viewer to look at the gutter.
  await stage.caption('Tracing inheritance, both ways?', {
    duration: 2600,
  });

  // Hop to an impl. CachedPokemonRepository overrides each method →
  // gutter shows `⬆ overrides` on each.
  await stage.openFile(
    'src/main/kotlin/com/example/data/CachedPokemonRepository.kt',
    { line: 0, column: 0 },
  );
  await stage.pause(2400);
  // Answer caption — declarative, names both directions.
  await stage.caption('⬇ to implementations. ⬆ back to the contract.', {
    duration: 2600,
  });
}
