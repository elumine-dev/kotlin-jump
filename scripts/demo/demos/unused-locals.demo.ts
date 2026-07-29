import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: unused locals, lambda parameters and catch bindings (KJ-027). ~13 s.
 *
 * WOW: the fix for a lambda parameter is not a deletion, it is an underscore.
 * That is the one place Kotlin allows `_`, and it says out loud what the
 * warning only hinted at: this one is ignored on purpose.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Anchor so the dead locals (line 9) and the lambda (line 19) share a
  // viewport. Anchors are 0-based here, the editor shows 1-based.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedLocalsDemo.kt',
    { line: 12, column: 1 },
  );
  await stage.pause(1200); // 400 ms provider debounce, then reading time
  await stage.assertDiagnostics('variables et bindings morts', 3);

  await stage.caption('What do you call a parameter you never read?', {
    duration: 2600,
  });

  // Two flavours in one view: a variable nobody reads, then the lambda.
  await stage.dwellOn({ line: 8, column: 13 }, 1300);
  void stage.calloutAt({ line: 18, column: 32 }, 'never read', 1800);
  await stage.dwellOn({ line: 18, column: 32 }, 1500);

  // Cursor on the lambda parameter, quick fix menu, then apply it.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedLocalsDemo.kt',
    { line: 18, column: 32, reveal: 'if-offscreen' },
  );
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', {
    kind: 'quickfix',
    apply: 'never',
  }).then(() => {}, () => {}); // late Canceled rejection kills the host without this
  await stage.pause(1700); // the title reads "Replace 'index' with '_'"
  await stage.runCommand('acceptSelectedCodeAction');
  await stage.pause(400);

  // Belt and braces: if the menu lost focus, run the same action directly.
  if ((vscode.window.activeTextEditor?.document.getText() ?? '').includes('{ index, row ->')) {
    await stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'first' });
    await stage.pause(400);
  }

  await stage.assertText('parametre renomme en underscore', '{ _, row ->');
  await stage.dwellOn({ line: 18, column: 32 }, 1500);

  await stage.caption('Underscore is the Kotlin way to say: ignored on purpose', {
    duration: 2600,
  });
  await stage.pause(1900);

  // Leave the workspace clean for the next demo.
  await stage.runCommand('undo');
  await stage.pause(500);
}
