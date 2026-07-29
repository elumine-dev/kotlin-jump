import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: unused Android resource files (KJ-029). ~13 s.
 *
 * WOW: one command sweeps the whole workspace and every dead layout, menu and
 * animation lands in the Problems panel with the APK weight it costs. The
 * quick fix then offers to delete the file itself, variants included, behind
 * the Refactor Preview.
 *
 * The delete is shown in the menu but not applied: removing a fixture file
 * cannot be undone reliably, and the demo must leave the workspace clean.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Start on a layout that nothing references. Anchors are 0-based.
  await stage.openFile('src/main/res/layout/view_kj_dead.xml', { line: 2, column: 1 });
  await stage.pause(600);

  await stage.caption('Which layouts does nobody open any more?', { duration: 2400 });

  // The real command, scanning every source in the workspace.
  await stage.runCommand('kotlin-jump.findUnusedResources');
  await stage.pause(2200);

  // Proof the scan landed on this very file.
  await stage.openFile('src/main/res/layout/view_kj_dead.xml', { line: 0, column: 1 });
  await stage.pause(800);
  await stage.assertDiagnostics('ressources mortes', 1);

  // The Problems panel holds the whole sweep, file by file.
  await stage.runCommand('workbench.actions.view.problems');
  await stage.pause(2400);
  await stage.runCommand('workbench.action.closePanel');
  await stage.pause(400);

  // The action offered on a dead file: delete it, variants included.
  await stage.openFile('src/main/res/layout/view_kj_dead.xml', { line: 0, column: 1 });
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', {
    kind: 'quickfix',
    apply: 'never',
  }).then(() => {}, () => {}); // late Canceled rejection kills the host without this
  await stage.pause(1900); // the title reads "Delete unused layout view_kj_dead.xml"
  await stage.runCommand('workbench.action.closeQuickOpen');
  await stage.pause(300);

  await stage.caption('Dead files, found and priced in APK weight', { duration: 2600 });
  await stage.pause(1900);

  // Nothing was edited, but clear the findings so the next demo starts fresh.
  await stage.runCommand('kotlin-jump.clearUnusedResources').then(() => {}, () => {});
}
