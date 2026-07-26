import { Stage } from '../lib/stage';

/**
 * Demo: Manifest necessity badges (KJ-023). ~11 s.
 *
 * One beat: the manifest tells you which permissions your code backs up
 * — and which one you'd have to justify to a Play Store reviewer with
 * nothing to show.
 *
 * WOW: READ_SMS greyed with « aucun usage trouvé », CAMERA confirmed.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile('src/main/AndroidManifest.xml', { line: 10, column: 5 });
  await stage.pause(1600);
  await stage.assertDecorations('badges manifest', 'manifestNecessity', 3);

  await stage.caption('Every permission needs a reason', {
    duration: 2400,
  });
  await stage.dwellOn({ line: 10, column: 60 }, 1400);

  // Ligne 37 (0-idx) = READ_SMS — aucun usage trouvé.
  await stage.openFile('src/main/AndroidManifest.xml', {
    line: 37,
    column: 5,
    reveal: 'if-offscreen',
  });
  void stage.calloutAt({ line: 37, column: 66 }, 'no SMS code anywhere', 2200);
  await stage.dwellOn({ line: 37, column: 66 }, 1600);

  await stage.caption('Permission with no code behind it, caught before review', {
    duration: 2600,
  });
  await stage.pause(2200);
}
