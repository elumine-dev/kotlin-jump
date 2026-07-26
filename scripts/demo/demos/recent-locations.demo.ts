import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Recent locations (KJ-008). ~12 s.
 *
 * One beat: after hopping through a few files, one shortcut lists every
 * place you've been — with a code excerpt per entry, not just a path.
 *
 * WOW: the excerpts. You recognise the spot without opening it.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Un vrai parcours : trois fichiers, trois endroits.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/UdfXrayViewModel.kt',
    { line: 23, column: 17 },
  );
  await stage.pause(700);
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt',
    { line: 20, column: 5 },
  );
  await stage.pause(600);
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g6editor/SqlQueryDao.kt',
    { line: 15, column: 9 },
  );
  await stage.pause(700);

  await stage.caption('Three files deep. Where was that again?', {
    duration: 2200,
  });

  // NE PAS await : le QuickPick attend un choix utilisateur, la commande
  // ne rend la main qu'à sa fermeture (sinon la demo se bloque).
  await stage.assertVisible('historique avec extraits', async () => {
    const items = await vscode.commands.executeCommand<unknown[]>(
      'kotlin-jump._recentSnapshot');
    return Array.isArray(items) && items.length >= 3;
  }, 5000);
  void stage.runCommand('kotlin-jump.recentLocations');
  // Le QuickPick s'ouvre : laisser le temps de lire les extraits.
  await stage.pause(2400);

  await stage.caption('Every stop, with its snippet of code', {
    duration: 2600,
  });
  await stage.pause(1600);

  await stage.runCommand('workbench.action.closeQuickOpen').then(() => {}, () => {});
  await stage.pause(400);
}
