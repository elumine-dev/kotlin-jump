import { Stage } from '../lib/stage';

/**
 * Demo: Code Lens — `N usages` on an interface header.
 *
 * Single act, single payoff: click the usage count above a contract,
 * the Find Usages panel opens populated. ~12 s.
 *
 * Trimmed from an earlier three-act version (usages / implementations /
 * overrides) that ran 34 s and weighed 14 MB. One clean moment beats
 * a feature tour — Code Lens itself is visible on every line of the
 * setup, so the viewer sees the pattern without a guided tour.
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

  await stage.pause(1800);
  await stage.caption('Every interface carries a lens. Look up.', {
    duration: 2400,
  });

  // ── Act: `N usages` ──────────────────────────────────────────────────
  // Line 15 is `interface PokemonRepository {` — 29 chars. Callout
  // columns MUST be past end-of-line (>= 29), otherwise the `after`
  // decoration renders inside the word and splits it visually.
  void stage.calloutAt({ line: 15, column: 29 }, 'N usages', 2000);
  await stage.caption('Who touches this contract?', {
    duration: 2200,
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
  await stage.pause(1600);  // panel renders + viewer parses the list
  await stage.caption('Every caller, one click. 🎯', {
    duration: 2200,
  });
}
