import { Stage } from '../lib/stage';

/**
 * Demo: Welcome — hero tour, ~18 s.
 *
 * Before: a single Cmd+Click on a generic method — too thin to show
 * what Kotlin Jump actually does. Now: a mini-tour that touches the
 * three things users care about most:
 *
 *   1. Inline augmentations live WHERE you read the code — R.string
 *      folding shows UI text in place of keys; no hover needed.
 *   2. Cmd+Click jumps cross-file, under 1 ms.
 *   3. Navigate Back restores line AND column — the history is richer
 *      than VS Code's own.
 *
 * All on Pokemon-themed code, so the viewer doesn't feel like they're
 * reading tutorial filler.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Open a dense Pokemon-themed file ───────────────────────
  // PokedexScreen.kt — `render()` + `displayCard()` are rich with
  // R.string.* refs (folded to UI text) and type-icon emoji. Line 16
  // (0-idx) = `    fun render() {` so the viewport opens on the
  // high-traffic code.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexScreen.kt',
    { line: 16, column: 8 },
  );
  await stage.pause(1800);
  await stage.caption('UI text, inline. Keys folded. No LSP running. 🧭', {
    duration: 2400,
  });

  // ── Beat 2: Cmd+Click on a cross-file TYPE — BattleResult ──────────
  // `fun showBattleResult(result: BattleResult) {` lives at line 50
  // (0-idx) = line 51 (1-idx). `BattleResult` spans cols 33-44. Col 36
  // lands inside the type name. Click routes to Pokemon.kt on the
  // sealed class declaration, exposing the Victory / Defeat / Draw
  // variants — visually richer payoff than jumping to a plain getter.
  await stage.openFile(
    'src/main/kotlin/com/example/ui/PokedexScreen.kt',
    { line: 50, column: 36 },
  );
  await stage.dwellOn({ line: 50, column: 36 }, 700);
  await stage.caption('Cmd+Click a type. Cross-file. Under 1 ms.', {
    duration: 2200,
  });
  await stage.click('BattleResult', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  await stage.waitForEditor('Pokemon.kt');
  await stage.pause(1200);

  // ── Beat 3: Navigate Back — line AND column restored ───────────────
  // Cmd+Option+Left rewinds the nav stack. Because kotlin-jump tracks
  // column too, the caret lands EXACTLY where it started — not just
  // the same line.
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Navigate Back',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'PokedexScreen.kt', line: 50 },
    duration:    2200,
  });
  await stage.pause(1200);
  await stage.caption('Back — line AND column restored. Not just the file. 🎯', {
    duration: 2600,
  });

  // ── Beat 4: Closer — trailing pause for the fade-to-black ──────────
  await stage.caption('Kotlin Jump. All inline. All instant. ⚡', {
    duration: 2600,
  });
  await stage.pause(1000);
}
