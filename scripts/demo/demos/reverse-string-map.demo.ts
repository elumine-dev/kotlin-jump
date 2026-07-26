import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Reverse string map (KJ-018). ~14 s.
 *
 * Two-part beat, one idea: know WHERE a string shows up, then watch an
 * edit land everywhere at once.
 *  1. Hover the strings.xml entry: screen names, not file paths.
 *  2. Three editors side by side, the XML value is retyped, and the
 *     folded previews in BOTH consumers update on save.
 *
 * Révision 25/07 (demande Kevin) : la propagation multi-onglets est le
 * moment fort ; l'assertion vérifie les textes réellement peints par le
 * folding via la sonde `stringResourceFolding`.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 137 (0-idx) = <string name="battle_cry"> dans strings.xml.
  await stage.openFile('src/main/res/values/strings.xml', {
    line: 137,
    column: 20,
  });
  await stage.pause(400);

  // Deux colonnes lisibles (demande Kevin, 25/07) : le XML qu'on édite à
  // gauche, l'écran consommateur à droite avec sa valeur repliée. Trois
  // colonnes rendaient le texte trop petit et coupé au bord. Le split
  // s'installe d'entrée, la caption d'ouverture se lit par-dessus.
  const root = vscode.workspace.workspaceFolders![0].uri;
  const screens = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, 'src/main/kotlin/com/example/kj/g3navigation/ScreensDemo.kt'));
  const screensEd = await vscode.window.showTextDocument(screens, { viewColumn: vscode.ViewColumn.Two, preview: false });
  screensEd.revealRange(new vscode.Range(31, 0, 31, 0), vscode.TextEditorRevealType.InCenter);
  await stage.caption('One string, two screens. Edit it once.', {
    duration: 1800,
  });

  // Retour dans le XML (colonne 1) pour retaper la valeur, lettre à lettre.
  const xml = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, 'src/main/res/values/strings.xml'));
  await vscode.window.showTextDocument(xml, { viewColumn: vscode.ViewColumn.One, preview: false });
  await stage.pause(400);
  await stage.typeReplace(137, 'A wild battle cry appears!', 'CHARGE!',
    { backspaceMs: 25, typeMs: 110, settleMs: 300 });
  await stage.runCommand('workbench.action.files.save');

  // La sonde lit les textes PEINTS par le folding : la nouvelle valeur doit
  // être rendue dans les éditeurs voisins, pas seulement écrite dans le XML.
  let lastProbe: string[] = [];
  await stage.assertVisible('valeur propagee dans les folds', async () => {
    lastProbe = (await vscode.commands.executeCommand<string[]>(
      'kotlin-jump._probeTexts', 'stringResourceFolding')) ?? [];
    return lastProbe.some(t => t.includes('CHARGE!'));
  }, 6000).catch((e: Error) => {
    throw new Error(`${e.message} | sonde=${JSON.stringify(lastProbe.slice(0, 12))}`);
  });
  await stage.pause(500);

  await stage.caption('One edit, every screen updated', {
    duration: 2000,
  });
  await stage.pause(1000);

  // Remise à zéro instantanée (pas filmée à la frappe : budget).
  await stage.restoreFixtures();
  await stage.pause(300);
}
