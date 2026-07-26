import { Stage } from '../lib/stage';

/**
 * Demo: Resource shadowing (KJ-017). ~11 s.
 *
 * One beat: the same color name defined in two modules — hover tells
 * you which one actually wins the Gradle merge, and strikes the loser
 * through. The question every multi-module Android dev has asked.
 *
 * WOW: 🏆 on the winner, ~~struck through~~ on the shadowed one.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 16 (0-idx) = val winnerColor = R.color.primary
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g2resources/ResourceShadowingDemo.kt',
    { line: 16, column: 30 },
  );
  await stage.pause(1600);

  await stage.caption('primary is defined twice. Which one wins?', {
    duration: 2600,
  });
  await stage.dwellOn({ line: 16, column: 30 }, 1200);

  await stage.assertHover('multi-module shadowing hover', { line: 16, column: 30 }, 'shadowed');
  await stage.runCommand('editor.action.showHover');
  await stage.pause(1000);

  await stage.caption('Gradle merge order, spelled out 🏆', {
    duration: 2800,
  });
  await stage.pause(2600);

  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});
  await stage.pause(300);
}
