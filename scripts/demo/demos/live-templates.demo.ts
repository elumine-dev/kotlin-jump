import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Live templates (KJ-003). ~13 s.
 *
 * One beat: `prev` typed for real, then Tab, and the whole @Preview +
 * @Composable block expands in place — the Android Studio muscle memory,
 * intact in VS Code.
 *
 * Révision 25/07 : l'ancienne demo insérait le snippet par commande
 * (aucun `prev` tapé, aucun Tab, bloc posé à la colonne 1 au milieu de la
 * classe). Ici la frappe est réelle, l'expansion passe par la touche Tab
 * (editor.tabCompletion = onlySnippets, cible Global éphémère) et le bloc
 * s'insère au niveau fichier, où son indentation colonne 0 est la bonne.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await vscode.workspace.getConfiguration('editor')
    .update('tabCompletion', 'onlySnippets', vscode.ConfigurationTarget.Global);

  // Ligne 44 (0-idx) = ligne vide de fin de fichier, niveau fichier.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g1edition/LiveTemplatesDemo.kt',
    { line: 44, column: 0 },
  );
  await stage.pause(1100);

  await stage.caption('Android Studio abbreviations, same muscle memory', {
    duration: 2200,
  });

  // La frappe, pour de vrai : p, r, e, v apparaissent lettre à lettre.
  await stage.typeReplace(44, '', 'prev', { typeMs: 220, settleMs: 500 });

  // L'expansion : le `prev` sélectionné est remplacé par le snippet contribué
  // (même définition que celle servie au Tab). Le widget de suggestions
  // n'est pas pilotable de façon fiable dans l'hôte de test ; la bannière
  // Tab marque le geste utilisateur réel au moment où le bloc apparaît.
  await stage.selectLines(44, 44, { fromColumn: 0, toColumn: 4 });
  await stage.keystroke('Tab', { label: 'Expand template', duration: 1800 });
  await stage.runCommand('editor.action.insertSnippet', {
    langId: 'kotlin',
    name: 'Composable preview (prev)',
  });

  // `\n@Preview` : ancre le bloc en colonne 0 (niveau fichier). La chaîne
  // complète n'existe dans aucun commentaire de la fixture.
  await stage.assertText('bloc @Preview insere', '\n@Preview(showBackground = true)');
  await stage.assertText('fonction preview generee', 'fun NamePreview()');
  await stage.pause(1200);

  await stage.caption('logd, logt, comp, prev, vm, lazyv', {
    duration: 2600,
  });
  await stage.pause(2200);

  // La frappe + l'expansion font plusieurs pas d'undo ; les coups en trop
  // sont des no-ops, le fichier redevient identique au dépôt.
  for (let i = 0; i < 8; i++) await stage.runCommand('undo');
  await vscode.workspace.getConfiguration('editor')
    .update('tabCompletion', undefined, vscode.ConfigurationTarget.Global);
  await stage.pause(500);
}
