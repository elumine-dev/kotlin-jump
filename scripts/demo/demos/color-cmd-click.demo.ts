import { Stage } from '../lib/stage';

/**
 * Demo: Cmd+Click on R.color → jumps to colors.xml at the matching
 * `<color name="X">` declaration.
 *
 * Story: a dev reads `setBackgroundColor(R.color.primary)` and wants
 * to know the actual hex. Cmd+Click on `R.color.primary` opens
 * `res/values/colors.xml` at the line where `<color name="primary">`
 * is defined.
 *
 * WOW: cross-file Kotlin → XML resolution, no LSP, no setup. The
 * inline swatch already showed the colour; this jumps to the source
 * for editing.
 *
 * Narrative: Setup (cursor on R.color.primary) → Action (Cmd+Click)
 * → WOW (lands in colors.xml) → Relief. ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  // ColorResourceIndex is populated asynchronously via `findFiles` +
  // `reindexFile` after activation. Wait until `R.color.primary`
  // resolves — otherwise the click fires before the XML is indexed.
  await stage.waitForDefinition(
    'src/main/kotlin/com/example/demo/ColorResourceDemo.kt',
    { line: 19, column: 32 },
  );

  // Setup: ColorResourceDemo line 20 (1-idx) = line 19 (0-idx):
  //   `val BRAND_PRIMARY   = R.color.primary`
  // `primary` spans cols 30-36. Col 32 lands in the middle of the
  // resource key — `getWordRangeAtPosition` resolves to `primary`,
  // not to `R` at col 22 (which was the old position and had no
  // definition).
  await stage.openFile(
    'src/main/kotlin/com/example/demo/ColorResourceDemo.kt',
    { line: 19, column: 32 },
  );
  await stage.dwellOn({ line: 19, column: 32 }, 1000);
  await stage.caption('So what hex is `R.color.primary` really?', {
    duration: 2200,
  });

  await stage.click('primary', {
    modifier: 'Cmd',
    label:    'Go to Definition',
  });
  // The DefinitionProvider routes R.color.primary to colors.xml. We
  // don't pin a specific line because the XML formatting may vary;
  // matching by file is enough.
  await stage.waitForEditor('colors.xml');
  await stage.pause(1400);

  await stage.caption('Straight into colors.xml. Edit and save. 🎨', {
    duration: 2600,
  });
}
