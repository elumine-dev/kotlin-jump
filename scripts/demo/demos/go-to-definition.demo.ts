import { Stage } from '../lib/stage';

/**
 * Demo: Go to Definition (Cmd+Click) — cross-file, cross-module symbol
 * resolution.
 *
 * Story: a dev reads `PokedexScreen.showBattleResult` and sees
 * `BattleResult.Victory` referenced. Where is `BattleResult` defined?
 * Cmd+Click on the type name jumps to the sealed class declaration in
 * `Pokemon.kt` — a different file, in a different package directory,
 * resolved instantly.
 *
 * WOW: VS Code without an LSP can't follow this. Kotlin Jump's regex
 * parser indexes the entire workspace at startup; the lookup is < 1 ms
 * regardless of project size.
 *
 * Narrative: Setup (cursor on `BattleResult` in PokedexScreen) →
 * Action (Cmd+Click) → WOW (lands on `sealed class BattleResult` in
 * Pokemon.kt) → Relief (one-line takeaway). ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: PokedexScreen.kt line 53 (1-idx) = line 52 (0-idx),
  // column 15 = the `B` of `BattleResult.Victory`. Word-level halo
  // tells the viewer EXACTLY which symbol is about to be resolved.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexScreen.kt',
    { line: 52, column: 15 },
  );
  await stage.dwellOn({ line: 52, column: 15 }, 1100);
  // Q→R rhythm: question primes the viewer's attention, the jump
  // answers it, the closing caption seals the answer.
  await stage.caption('Where is BattleResult defined?', { duration: 2200 });

  // Action: Cmd+Click → resolves cross-file to Pokemon.kt line 28
  // (1-idx) = line 27 (0-idx) where `sealed class BattleResult` lives.
  // The card overlay names the action, the landing pulse confirms
  // arrival.
  await stage.click('BattleResult', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  await stage.waitForEditor('Pokemon.kt', 27);
  // Hold so the viewer registers BOTH the file change (visible via the
  // tab) AND the landing pulse on the sealed class declaration.
  await stage.pause(1200);

  // Answer caption — declarative, names the value with a number.
  await stage.caption('There. Cross-file, cross-package. Under 1 ms. ⚡', {
    duration: 2400,
  });
}
