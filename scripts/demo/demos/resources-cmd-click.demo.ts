import { Stage } from '../lib/stage';

/**
 * Demo: Cmd+Click on every Android resource type — one file, four
 * jumps. `R.string`, `R.color`, `R.drawable`, `R.dimen` each resolve
 * to their XML (or drawable asset) definition, cross-file, no LSP.
 *
 * Story: ResourceShowcase.kt holds one reference per resource type.
 * The demo cycles through each: Cmd+Click → land on the definition →
 * navigate back → next line. Four beats, one finale.
 *
 * WOW: every resource category the extension covers, in a single
 * recording. The viewer sees breadth, not just one trick.
 */
export default async function record(stage: Stage): Promise<void> {
  const showcase = 'src/main/kotlin/com/example/demo/ResourceShowcase.kt';

  await stage.waitForIndexReady();
  // ColorResourceIndex, DimenResourceIndex and the drawable file
  // scanner populate asynchronously. Wait until the first target
  // resolves before firing clicks.
  await stage.waitForDefinition(showcase, { line: 11, column: 35 });

  // ── Opening ───────────────────────────────────────────────────────
  await stage.openFile(showcase, { line: 11, column: 35 });
  await stage.caption('Every Android resource, one Cmd+Click away.', {
    duration: 2400,
  });

  // ── Beat 1: R.string ──────────────────────────────────────────────
  // Line 12 (1-idx) = line 11 (0-idx):
  //   `    val screenTitle = R.string.title_pokedex`
  // `title_pokedex` starts at col 31; col 35 lands inside the key.
  await stage.dwellOn({ line: 11, column: 35 }, 700);
  await stage.click('title_pokedex', {
    modifier: 'Cmd',
    label:    'R.string → strings.xml',
  });
  await stage.waitForEditor('strings.xml');
  await stage.pause(1400);
  await stage.caption('Strings — straight into values/strings.xml.', {
    duration: 2200,
  });
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Back to showcase',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'ResourceShowcase.kt' },
    duration:    1600,
  });

  // ── Beat 2: R.color ───────────────────────────────────────────────
  // Line 13 (1-idx) = line 12 (0-idx):
  //   `    val brandColor  = R.color.primary`
  // `primary` starts at col 30; col 33 lands inside the key.
  // Re-open the file to move the cursor — `dwellOn` only flashes,
  // doesn't reposition `editor.selection.active`, which `click` reads.
  await stage.openFile(showcase, { line: 12, column: 33 });
  await stage.dwellOn({ line: 12, column: 33 }, 500);
  await stage.click('primary', {
    modifier: 'Cmd',
    label:    'R.color → colors.xml',
  });
  await stage.waitForEditor('colors.xml');
  await stage.pause(1400);
  await stage.caption('Colors — the hex lives here.', {
    duration: 2200,
  });
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Back to showcase',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'ResourceShowcase.kt' },
    duration:    1600,
  });

  // ── Beat 3: R.drawable ────────────────────────────────────────────
  // Line 14 (1-idx) = line 13 (0-idx):
  //   `    val pokemonIcon = R.drawable.ic_pokeball`
  // `ic_pokeball` starts at col 33; col 38 lands inside the key.
  await stage.openFile(showcase, { line: 13, column: 38 });
  await stage.dwellOn({ line: 13, column: 38 }, 500);
  await stage.click('ic_pokeball', {
    modifier: 'Cmd',
    label:    'R.drawable → drawable file',
  });
  await stage.waitForEditor('ic_pokeball.xml');
  await stage.pause(1400);
  await stage.caption('Drawables — vector, png, webp, all resolved.', {
    duration: 2200,
  });
  await stage.navigate({
    shortcut:    '⌘ + ⌥ + ←',
    label:       'Back to showcase',
    command:     'kotlinJump.navigateBack',
    awaitEditor: { file: 'ResourceShowcase.kt' },
    duration:    1600,
  });

  // ── Beat 4: R.dimen ───────────────────────────────────────────────
  // Line 15 (1-idx) = line 14 (0-idx):
  //   `    val paddingMd   = R.dimen.spacing_md`
  // `spacing_md` starts at col 30; col 34 lands inside the key.
  await stage.openFile(showcase, { line: 14, column: 34 });
  await stage.dwellOn({ line: 14, column: 34 }, 500);
  await stage.click('spacing_md', {
    modifier: 'Cmd',
    label:    'R.dimen → dimens.xml',
  });
  await stage.waitForEditor('dimens.xml');
  await stage.pause(1400);
  await stage.caption('Dimens — spacing, sizes, paddings.', {
    duration: 2200,
  });

  // ── Closer ────────────────────────────────────────────────────────
  await stage.caption('Strings, colors, drawables, dimens. 🎯', {
    duration: 2800,
  });
  await stage.pause(800);
}
