import { Stage } from '../lib/stage';

/**
 * Demo: Find Usages panel + test filter.
 *
 * Target: `PokemonRepository.catch(id: Int)` — the `catch` abstract
 * method on the repository interface. Real callers across the fixture:
 *
 *   - Production:
 *       * `PokedexViewModel.catchPokemon` → `repository.catch(id)`
 *       * `CachedPokemonRepository` → `delegate.catch(id)` +
 *         6 concrete `override suspend fun catch(...)` declarations
 *         across the impl classes.
 *   - Tests:
 *       * `PokemonCatchBehaviorTest` — 8 `@Test` methods, each
 *         invoking `.catch(...)` on fake / in-memory / cached
 *         variants.
 *       * `PokedexScreenTest` — anonymous `object : PokemonRepository
 *         { override suspend fun catch(...) }` stub.
 *
 * That spread is the whole point of the demo: the panel opens with
 * production calls AND test calls intermixed; one click filters tests
 * out so only the real call sites remain; a second click brings them
 * back — no re-scan.
 *
 * Pipeline:
 *   `kotlin-jump.findUsages` is called WITH `exclude` args. That
 *   sidesteps the `smartNavigation=false + no-args → goToReferences`
 *   fallback (`src/extension.ts:374`) and routes through
 *   `usagesPanel.search` — the custom panel path. `kotlinJump.findUsages.focus`
 *   then brings the bottom panel into view.
 *
 * ~18 s total.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Setup ───────────────────────────────────────────────────
  // PokemonRepository.kt line 24 (0-idx) = line 25 (1-idx):
  //   `    suspend fun catch(id: Int): Pokemon`
  // `catch` starts at col 16. Landing at col 17 puts the caret
  // inside the name — `getWordRangeAtPosition` resolves to `catch`.
  const editor = await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 24, column: 17 },
  );
  await stage.dwellOn({ line: 24, column: 17 }, 1000);
  await stage.caption('Who calls `catch`? Prod, tests, or both?', {
    duration: 2800,
  });

  // ── Beat 2: Open the panel with Alt+F7 ──────────────────────────────
  // Keystroke banner for narrative; then fire the command with
  // `exclude` args to force the PANEL path (`excludeLine` is 0-idx).
  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages', {
    excludeUri:  editor.document.uri.toString(),
    excludeLine: 24,
  });
  // Bring the bottom panel into focus in case its area was collapsed.
  await stage.runCommand('kotlinJump.findUsages.focus');
  // 3 s — the panel populates ~12-15 entries (impl overrides, prod
  // callers, 8 test callers). Viewer has time to spot 🧪 beakers on
  // `PokemonCatchBehaviorTest.kt` and `PokedexScreenTest.kt`.
  await stage.pause(3000);
  await stage.caption('Prod calls mixed with test calls. 🧪 marks the tests.', {
    duration: 3000,
  });

  // ── Beat 3: Hide tests ──────────────────────────────────────────────
  // $(beaker) toolbar icon → `toggleTests` → provider flips
  // `showTests=false`; test FileNodes filtered by `_visibleFiles()`
  // (`FindUsagesPanel.ts:212`). The wall of test rows collapses.
  await stage.clickLens(
    'Hide tests',
    'kotlin-jump.findUsages.toggleTests',
  );
  await stage.pause(2200);
  await stage.caption('Tests hidden. Only production call sites remain.', {
    duration: 2800,
  });

  // ── Beat 4: Show tests again ────────────────────────────────────────
  // Same command flips `showTests=true`. `allFiles` cache is unchanged
  // — the test rows reappear in one frame, no workspace re-scan.
  await stage.clickLens(
    'Show tests',
    'kotlin-jump.findUsages.toggleTests',
  );
  await stage.pause(1800);
  await stage.caption('Click again. Full list back. Zero re-scan.', {
    duration: 2600,
  });

  // ── Beat 5: Close ───────────────────────────────────────────────────
  await stage.caption('One panel. Every caller. One-click filter. 🎚️', {
    duration: 2800,
  });
}
