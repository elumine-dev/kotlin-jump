import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Compose Outline Tree (KJ-015). ~13 s.
 *
 * One beat: put the caret in a @Composable, OPEN the Compose Outline view
 * and watch the whole UI structure appear as a tree — branches labelled,
 * loops marked, recursion cut — without building or previewing anything.
 *
 * Révision 25/07 : l'ancienne demo n'ouvrait jamais la vue (déclarée
 * `collapsed` dans l'Explorer) et filmait le commentaire de la fixture.
 * Le beat central est maintenant le `.focus` qui déplie la vue à l'écran,
 * et l'assertion exige `visible === true` en plus du contenu.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 11 (0-idx) = fun BattleDashboard(...)
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g3navigation/OutlineTreeDemo.kt',
    { line: 11, column: 5 },
  );
  await stage.pause(1200);

  await stage.caption('What does this screen actually render?', {
    duration: 2400,
  });

  // Caret dans le corps : c'est ce qui alimente l'arbre.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g3navigation/OutlineTreeDemo.kt',
    { line: 13, column: 9 },
  );
  await stage.pause(600);

  // LE beat : la vue s'ouvre à l'écran, l'arbre se remplit. Les vues KJ
  // vivent dans leur container d'activity bar (décision 25/07, demande
  // Kevin : la section fichiers écrasait l'arbre en bas de l'Explorer) :
  // le focus ouvre une sidebar où l'arbre a toute la hauteur.
  await stage.runCommand('kotlinJump.composeOutline.focus');
  await stage.assertVisible('vue Compose Outline ouverte et remplie', async () => {
    const snap = await vscode.commands.executeCommand<{
      items: unknown[]; visible: boolean;
    }>('kotlin-jump._outlineSnapshot');
    return snap != null && snap.visible === true
      && Array.isArray(snap.items) && snap.items.length > 0;
  }, 6000);
  // Le rendu du tree met ~2 s à se peindre après le focus : laisser
  // l'arbre occuper l'écran AVANT la caption, c'est lui le beat.
  await stage.pause(2600);

  // Défilement vers la fin de l'arbre : les marqueurs ×items et ↺
  // (récursion coupée) vivent dans les dernières rangées.
  await stage.runCommand('kotlin-jump._outlineRevealTail');
  await stage.pause(1600);

  await stage.caption('Branches, loops and recursion, with no build', {
    duration: 2800,
  });
  await stage.pause(2600);
}
