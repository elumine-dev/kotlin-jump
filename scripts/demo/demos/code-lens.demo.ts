import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Code Lens — three distinct lenses, one per act, each clicked
 * so the viewer sees the payoff.
 *
 * Three lenses exist across the fixture:
 *   1. `N usages`            (CodeLensProvider usageOnly)  — interface header
 *   2. `⬇ N implementations` (OverrideGutterProvider class) — interface header
 *   3. `⬆ overrides`         (OverrideGutterProvider method) — impl methods
 *
 * Narrative:
 *   Setup → Act 1 (click `N usages` → Find Usages panel opens) →
 *   Act 2 (click `⬇ 6 implementations` → QuickPick lists the 6 impls) →
 *   Act 3 (hop to CachedPokemonRepository, click `⬆ overrides` →
 *   jump back to the interface's `catch` method) → closer. ~24 s.
 *
 * WOW: every count is clickable and each one carries a DIFFERENT
 * action — usage panel, impl picker, parent-def reveal — so the demo
 * proves the lenses aren't decorative, they're three separate tools
 * sharing a visual language.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Setup ────────────────────────────────────────────────────────────
  // PokemonRepository.kt — interface declared at line 15 (0-idx) =
  // line 16 (1-idx). Name `PokemonRepository` starts at col 10.
  // Above it the lens line reads: "⬇ 6 implementations | N usages".
  const repo = await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 15, column: 15 },
  );
  const repoUri  = repo.document.uri;
  const repoName = 'PokemonRepository';
  const repoFqn  = 'com.example.data.PokemonRepository';
  const repoPkg  = 'com.example.data';

  await stage.pause(2500);
  await stage.caption('Two lenses on this interface. A third hides on its children.', {
    duration: 2600,
  });

  // ── Act 1: `N usages` ────────────────────────────────────────────────
  // Line 15 is `interface PokemonRepository {` — 29 chars. Callout
  // columns MUST be past end-of-line (>= 29), otherwise the `after`
  // decoration renders inside the word and splits it visually.
  void stage.calloutAt({ line: 15, column: 29 }, 'N usages', 2000);
  await stage.caption('Who touches this contract?', {
    duration: 2400,
  });
  // Fire the exact command the lens carries when clicked:
  //   `kotlin-jump.codeLensAction(uri, line, character, name, fqn)`
  // (CodeLensProvider.ts:155). This re-positions the caret on the
  // interface name, then opens the Find Usages panel — identical to
  // what VS Code does on a real lens click.
  await stage.clickLens(
    'N usages → Find Usages',
    'kotlin-jump.codeLensAction',
    repoUri, 15, 10, repoName, repoFqn,
  );
  await stage.pause(1800);  // panel renders + viewer parses the list
  await stage.caption('Every caller, one click. 🎯', {
    duration: 2400,
  });
  // Clean the viewport before Act 2.
  await stage.runCommand('workbench.action.closePanel').then(() => {}, () => {});
  await stage.pause(400);

  // ── Act 2: `⬇ N implementations` ─────────────────────────────────────
  // Return to the interface header. Col 20 lands on the left half of
  // the lens line (before the `|`), where the `⬇ 6 implementations`
  // arrow sits.
  await stage.openFile(
    'src/main/kotlin/com/example/data/PokemonRepository.kt',
    { line: 15, column: 15 },
  );
  void stage.calloutAt({ line: 15, column: 29 }, '⬇ 6 implementations', 2000);
  await stage.caption('Every concrete repo, right below.', {
    duration: 2400,
  });
  // Fire the exact command the lens carries: `goToClassImpl(name, pkg)`
  // (OverrideGutterProvider.ts:52-58). Use the NON-BLOCKING variant
  // because the command `await`s `showQuickPick`, which only resolves
  // when the user picks. If we awaited it, the follow-up `accept…`
  // step would never run and the demo would stall waiting for a real
  // human interaction.
  await stage.clickLensOpen(
    '⬇ 6 implementations → Go to Implementation',
    'kotlin-jump.goToClassImpl',
    repoName, repoPkg,
  );
  // Let the QuickPick render + the viewer read the list (6 concrete
  // impls, alphabetical: Cached, Fake, InMemory, Network, Offline,
  // PokemonRepositoryImpl — anonymous entries pushed to the bottom by
  // the sort added in extension.ts).
  await stage.pause(1800);
  await stage.caption('Six repos. Grab the caching one.', {
    duration: 2400,
  });
  // Accept the FIRST item (CachedPokemonRepository after the sort).
  // This lets the viewer watch the QuickPick resolve into a real
  // navigation — no "window just closes" jarring cut.
  await stage.runCommand('workbench.action.acceptSelectedQuickOpenItem');
  await stage.waitForEditor('CachedPokemonRepository.kt');
  await stage.pause(900);
  await stage.caption('Landed. Same contract, concrete impl. ✨', {
    duration: 2200,
  });

  // ── Act 3: `⬆ overrides` ─────────────────────────────────────────────
  // CachedPokemonRepository.kt — line 18 (0-idx) = line 19 (1-idx) =
  // `    override suspend fun catch(id: Int): Pokemon {`. The lens
  // "⬆ overrides" renders just above. Caret on the METHOD NAME
  // (`catch` starts at col 25) — command handlers read the symbol
  // under the cursor, so landing on a keyword would resolve nothing.
  const impl = await stage.openFile(
    'src/main/kotlin/com/example/data/CachedPokemonRepository.kt',
    { line: 18, column: 25 },
  );
  await stage.dwellOn({ line: 18, column: 25 }, 900);
  // Arrow at col 38 (end of `catch(id: Int): Pokemon`) — above the
  // method name is where the lens anchor reads best.
  // Past end-of-line (line is 50 chars: `    override suspend fun catch(id: Int): Pokemon {`)
  // Col 38 used to land on `)` of `Int)`, splitting the signature visually.
  void stage.calloutAt({ line: 18, column: 50 }, '⬆ overrides', 2000);
  await stage.caption('Back to the contract, one click up.', {
    duration: 2400,
  });
  // Click → `kotlin-jump.revealDefinitionAt(uri, position)` runs the
  // definition provider at the `catch` name and opens the resulting
  // Location (interface declaration at line 24 0-idx). The method name
  // starts at col 25 in `    override suspend fun catch(...)`.
  await stage.clickLens(
    '⬆ overrides → Reveal Definition',
    'kotlin-jump.revealDefinitionAt',
    impl.document.uri,
    new vscode.Position(18, 25),
  );
  await stage.waitForEditor('PokemonRepository.kt', 24);
  await stage.pause(1200);
  await stage.caption('Same method. Straight back to where it was declared.', {
    duration: 2400,
  });

  // ── Closer ───────────────────────────────────────────────────────────
  await stage.caption('Three lenses. Three directions. All clickable. 🧭', {
    duration: 2800,
  });
}
