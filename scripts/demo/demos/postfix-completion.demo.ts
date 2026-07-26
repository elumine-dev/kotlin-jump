import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Postfix completion (KJ-002). ~11 s.
 *
 * Un beat : taper `.null` après une expression, et la vraie complétion
 * du provider la retourne en check complet.
 *
 * La première version SIMULAIT la transformation avec replaceText : le
 * spectateur voyait du texte changer sans que la feature tourne. Ici la
 * complétion est réellement invoquée et son insertion appliquée.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g1edition/PostfixCompletionDemo.kt',
    { line: 15, column: 9 },
  );
  await stage.pause(1200);

  await stage.caption('The null check, written backwards', {
    duration: 2200,
  });

  // Le geste réel : on tape `pikachu.null`, puis le provider transforme.
  // (typeReplace déclenche le widget de suggestions pendant la frappe et
  // rend la sonde de complétion muette : on garde l'insertion atomique.)
  await stage.replaceText(15, '        ', '        pikachu.null');
  await stage.pause(900);

  // La VRAIE feature : on interroge le provider de complétion et on
  // applique son insertion. Rien n'est simulé.
  await stage.assertVisible('proposition postfix du provider', async () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) return false;
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      new vscode.Position(15, 20),
      '.',
    );
    // label peut être une string OU un CompletionItemLabel { label, description }.
    const labelOf = (i: vscode.CompletionItem) =>
      typeof i.label === 'string' ? i.label : (i.label?.label ?? '');
    const hit = list?.items.find(i => labelOf(i) === 'null');
    if (!hit) return false;
    const snippet = (hit.insertText as vscode.SnippetString)?.value ?? '';
    if (!snippet.includes('== null')) return false;
    // insertSnippet, NOT a plain edit: VS Code re-indents the lines after
    // the first, which is exactly what a user pressing Tab gets. Inserting
    // the raw text left the closing brace in column 0, and that is the
    // broken indentation Kevin saw in the first cut of this GIF.
    const editor = vscode.window.activeTextEditor!;
    await editor.insertSnippet(
      new vscode.SnippetString(snippet),
      new vscode.Range(15, 8, 15, 20),
    );
    return true;
  }, 5000);
  await stage.pause(700);

  void stage.calloutAt({ line: 15, column: 20 }, 'provider expansion', 2000);
  await stage.caption('Postfix completion: .null .let .for .when', {
    duration: 2600,
  });
  await stage.pause(2200);

  await stage.runCommand('undo');
  await stage.pause(200);
  await stage.runCommand('undo');
  await stage.pause(400);
}
