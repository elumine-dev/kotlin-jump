import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Android project view (KJ-012). ~11 s.
 *
 * One beat: the Kotlin Jump activity-bar container groups the workspace
 * the way Android Studio does: modules, manifests, kotlin+java, res
 * grouped by type, Gradle scripts. The demo shows the plain Explorer
 * first, then switches: before/after in one gesture.
 *
 * WOW: two modules side by side, res folders collapsed by type instead
 * of a flat qualifier soup.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt',
    { line: 12, column: 5 },
  );
  await stage.pause(900);

  await stage.showExplorer();
  await stage.pause(800);

  await stage.caption('The tree, grouped the Android Studio way', {
    duration: 2600,
  });

  await stage.runCommand('kotlinJump.androidProjectView.focus');
  await stage.assertVisible('vue Android peuplée', async () => {
    const mods = await vscode.commands.executeCommand<unknown[]>(
      'kotlin-jump._androidViewRoots');
    return Array.isArray(mods) && mods.length >= 2;
  }, 8000);
  await stage.pause(2000);

  await stage.caption('Modules, manifests, res by type, Gradle scripts', {
    duration: 2800,
  });
  await stage.pause(2600);
}
