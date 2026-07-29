import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: unused parameter removal, call sites included (KJ-025). ~13 s.
 *
 * WOW: the quick fix does not just delete the parameter. Its title announces
 * "and 2 arguments", and applying it strips the argument from a positional
 * call AND from a named one, in a single gesture. That is the part a
 * regex-only tool is not supposed to manage.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Anchor mid-file so the declaration (line 8) and both call sites
  // (lines 25 and 26) share one viewport. Anchors are 0-based here.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedParamsDemo.kt',
    { line: 16, column: 1 },
  );
  await stage.pause(1200); // 400 ms provider debounce, then reading time
  await stage.assertDiagnostics('parametres morts', 3);

  await stage.caption('Who still passes this argument?', { duration: 2400 });

  // The dead parameter, and right under it the two calls that feed it.
  void stage.calloutAt({ line: 7, column: 5 }, 'never read', 1800);
  await stage.dwellOn({ line: 7, column: 5 }, 1500);
  await stage.dwellOn({ line: 24, column: 25 }, 1400);

  // Cursor on the parameter, quick fix menu on screen, then apply it.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g5deadweight/UnusedParamsDemo.kt',
    { line: 7, column: 5, reveal: 'if-offscreen' },
  );
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', {
    kind: 'quickfix',
    apply: 'never',
  }).then(() => {}, () => {}); // late Canceled rejection kills the host without this
  await stage.pause(1800); // the title reads "and 2 arguments"
  await stage.runCommand('acceptSelectedCodeAction');
  await stage.pause(400);

  // Belt and braces: if the menu lost focus, run the same action directly.
  if ((vscode.window.activeTextEditor?.document.getText() ?? '').includes('retryCount: Int')) {
    await stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'first' });
    await stage.pause(400);
  }

  // Proof: the declaration is gone, and so are both arguments.
  await stage.assertVisible('parametre et arguments retires', () => {
    const text = vscode.window.activeTextEditor?.document.getText() ?? '';
    return text.length > 0
      && !text.includes('retryCount: Int')
      && !text.includes('"Q3", 3,')
      && !text.includes('retryCount = 5');
  });
  await stage.dwellOn({ line: 22, column: 25 }, 1600);

  await stage.caption('Gone from the signature and from both call sites', {
    duration: 2600,
  });
  await stage.pause(2000);

  // Leave the workspace clean for the next demo.
  await stage.runCommand('undo');
  await stage.pause(500);
}
