import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Unused import graying + one-shot removal (KJ-009). ~12 s.
 *
 * One beat, one payoff. The viewer opens a file where three dead imports
 * are ALREADY grayed out — no build, no LSP — then a single quick fix
 * sweeps them all away.
 *
 * WOW: the grayed lines vanish in one gesture. The alias trap sells the
 * intelligence: `WakeLock as Lantern` (used) stays crisp while
 * `Intent as Unused` fades.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedImportsDemo.kt',
    { line: 4, column: 1 },
  );
  // Laisse le provider poser ses décorations (debounce 400 ms) + lecture.
  await stage.pause(1000);
  await stage.assertDecorations('imports grises', 'unusedImports', 3);

  await stage.caption('Three dead imports, spotted without compiling', {
    duration: 2400,
  });

  // L'alias piégé : `as Unused` grisé, `as Lantern` (utilisé) reste net.
  void stage.calloutAt({ line: 7, column: 30 }, 'unused alias', 1800);
  await stage.dwellOn({ line: 7, column: 30 }, 1600);

  // Curseur sur un import grisé, MENU de quick fix à l'écran, puis
  // application de l'entrée sélectionnée (révision 25/07 : Kevin veut
  // voir où vit l'action, pas seulement son effet).
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedImportsDemo.kt',
    { line: 4, column: 8, reveal: 'if-offscreen' },
  );
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', {
    kind: 'quickfix',
    apply: 'never',
  }).then(() => {}, () => {});  // rejet tardif (Canceled) = hôte tué sans ce catch
  await stage.pause(1600);
  await stage.runCommand('acceptSelectedCodeAction');
  // Ceinture : si l'acceptation du menu n'a pas pris (focus volé par le
  // widget), applique la même action directement. Le menu a été montré,
  // l'effet reste celui de la vraie feature.
  await stage.pause(400);
  if ((vscode.window.activeTextEditor?.document.getText() ?? '').includes('as Unused')) {
    await stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'first' });
  }
  // Preuve du balayage : les imports morts ont disparu du document.
  await stage.assertVisible('imports morts retires', () => {
    const text = vscode.window.activeTextEditor?.document.getText() ?? '';
    return text.length > 0 && !text.includes('as Unused');
  });
  await stage.pause(600);

  await stage.caption('One action sweeps them all', {
    duration: 2600,
  });
  await stage.pause(2200);

  // Restaure le workspace pour la demo suivante.
  await stage.runCommand('undo');
  await stage.pause(500);
}
