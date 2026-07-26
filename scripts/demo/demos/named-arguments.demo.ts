import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Add names to call arguments (KJ-001). ~11 s.
 *
 * One beat: a bare call with three anonymous arguments becomes fully
 * named in a single action — IntelliJ's beloved Alt+Enter intention,
 * now in VS Code, no LSP.
 *
 * Révision 25/07 : l'ancienne demo visait un commentaire (popup « No code
 * actions » filmé en plein cadre) et l'assertion passait sur le texte du
 * commentaire. Les inlay hints sont coupés le temps de la demo, sinon les
 * `name:` fantômes rendent l'avant/après illisible.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Le settings.json du workspace demo force les hints à « on » et gagne
  // sur la cible Global : il faut surcharger AU niveau workspace, puis
  // restaurer exactement la valeur versionnée avant de rendre la main.
  await vscode.workspace.getConfiguration('editor')
    .update('inlayHints.enabled', 'off', vscode.ConfigurationTarget.Workspace);

  // Ligne 28 (0-idx) = `        createTrainer("Ada", 36, true)`
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g1edition/NamedArgumentsDemo.kt',
    { line: 28, column: 23 },
  );
  await stage.pause(1200);

  await stage.caption('Three arguments. Which is which?', { duration: 2200 });
  await stage.dwellOn({ line: 28, column: 23 }, 1400);

  // Ouvrir le MENU de code actions à l'écran (apply: never), le laisser
  // se lire, puis accepter l'entrée sélectionnée : le spectateur voit où
  // vit l'action, pas juste son effet. Ne pas await l'ouverture : le
  // widget ne rend la main qu'à sa fermeture.
  void stage.runCommand('editor.action.codeAction', {
    kind: 'refactor.rewrite',
    apply: 'never',
  }).then(() => {}, () => {});  // rejet tardif (Canceled) = hôte tué sans ce catch
  await stage.pause(1800);
  await stage.runCommand('acceptSelectedCodeAction');
  // Chaîne complète, indentation incluse : elle n'existe nulle part dans la
  // fixture au repos, l'assertion ne peut pas passer sur un commentaire.
  await stage.assertText(
    'arguments nommes',
    '        createTrainer(name = "Ada", age = 36, isChampion = true)',
  );
  await stage.pause(500);

  void stage.calloutAt({ line: 28, column: 40 }, 'named in one action', 2000);
  await stage.caption('Every argument carries its name', {
    duration: 2600,
  });
  await stage.pause(2400);

  await stage.runCommand('undo');
  // Restaure la valeur versionnée du workspace ('on') : git doit rester propre.
  await vscode.workspace.getConfiguration('editor')
    .update('inlayHints.enabled', 'on', vscode.ConfigurationTarget.Workspace);
  await stage.pause(500);
}
