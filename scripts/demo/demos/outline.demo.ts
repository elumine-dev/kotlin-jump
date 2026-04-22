import { Stage } from '../lib/stage';

/**
 * Demo: Outline panel — every symbol in the file mapped and clickable,
 * instantly, without an LSP.
 *
 * `Pokemon.kt` is 35 lines but PACKED:
 *   - `data class Pokemon` (5 props)
 *   - `enum class PokemonType` (6 entries + `isStrongAgainst`)
 *   - `sealed class BattleResult` (Victory / Defeat / Draw)
 *   - `typealias Pokedex`
 *
 * Every one of those shows up in the Outline tree, hierarchically.
 * kotlin-jump's regex-based `DocumentSymbolProvider` emits them in
 * sub-millisecond time — no LSP, no indexing spinner, no JVM.
 *
 * Narrative: open → collapse the file tree so the Outline owns the
 * sidebar → reveal the symbol map → click deep symbols, cursor jumps
 * instantly → relief. ~14 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: Open a dense Kotlin file ────────────────────────────────
  await stage.openFile(
    'src/main/kotlin/com/example/data/Pokemon.kt',
    { line: 0, column: 0 },
  );
  await stage.pause(1400);
  await stage.caption('Small file, lots of pieces. Where’s the battle logic?', {
    duration: 2200,
  });

  // ── Beat 2: Reveal the Outline, minimise the file tree ─────────────
  // Three steps, in order:
  //   1. `showExplorer`   — open the sidebar (Explorer view).
  //   2. `focusFilesExplorer` — focus the FILE TREE section so the
  //      next command has a target. Without this, the collapse
  //      command can fire against the wrong focused list.
  //   3. `collapseExplorerFolders` — fold every expanded folder.
  //      Combined with `explorer.autoReveal: false` (demo-settings
  //      .json), the tree doesn't re-expand when `openFile` lands on
  //      new files, so the Outline keeps the spotlight.
  //   4. `outline.focus` — focus + auto-expand the Outline section.
  await stage.showExplorer();
  await stage.runCommand('workbench.files.action.focusFilesExplorer');
  await stage.pause(300);
  await stage.runCommand('workbench.files.action.collapseExplorerFolders');
  await stage.pause(300);
  await stage.runCommand('outline.focus');
  await stage.pause(2200);
  await stage.caption('Every symbol, mapped. No LSP, no spinner. 🗺️', {
    duration: 2600,
  });

  // ── Beat 3: Jump to a deeply-nested method ──────────────────────────
  // `fun isStrongAgainst` sits inside `enum class PokemonType` (line
  // 18 0-idx = line 19 1-idx). Simulates a click on that row in the
  // Outline — the editor cursor lands on the method.
  await stage.openFile(
    'src/main/kotlin/com/example/data/Pokemon.kt',
    { line: 18, column: 8 },
  );
  await stage.dwellOn({ line: 18, column: 8 }, 900);
  await stage.caption('Click a method deep inside an enum. Straight to it.', {
    duration: 2400,
  });

  // ── Beat 4: Jump to a sealed-class variant ──────────────────────────
  // `data class Victory` inside `sealed class BattleResult` (line 28
  // 0-idx = line 29 1-idx). `Victory` name spans cols 15-21.
  await stage.openFile(
    'src/main/kotlin/com/example/data/Pokemon.kt',
    { line: 28, column: 15 },
  );
  await stage.dwellOn({ line: 28, column: 15 }, 900);
  await stage.caption('Sealed variants, typealiases, nested classes. All one click. ⚡', {
    duration: 2800,
  });
}
