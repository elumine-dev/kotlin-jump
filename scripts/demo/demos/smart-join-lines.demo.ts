import { Stage } from '../lib/stage';

/**
 * Demo: Smart join lines (KJ-007). ~10 s.
 *
 * One beat, doubled: a split string literal fuses into one, then a
 * chained call collapses onto its receiver — Ctrl+Shift+J like home.
 *
 * WOW: `"Gotta catch " + "them all!"` becomes ONE literal, quotes and
 * plus sign gone.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Line 9 (0-idx) = `    val motto = "Gotta catch " +`
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g1edition/SmartJoinLinesDemo.kt',
    { line: 9, column: 20 },
  );
  await stage.pause(1200);

  await stage.caption('One string, split across two lines', { duration: 2000 });
  await stage.dwellOn({ line: 9, column: 20 }, 1200);

  // Le menu de code actions s'ouvre à l'écran (l'action y est découvrable),
  // se lit, puis l'entrée sélectionnée s'applique. Ne pas await l'ouverture :
  // le widget ne rend la main qu'à sa fermeture.
  void stage.runCommand('editor.action.codeAction', {
    kind: 'refactor.rewrite',
    apply: 'never',
  }).then(() => {}, () => {});  // rejet tardif (Canceled) = hôte tué sans ce catch
  await stage.pause(1800);
  await stage.runCommand('acceptSelectedCodeAction');
  await stage.assertText('literals merged', '"Gotta catch them all!"');
  await stage.pause(700);

  void stage.calloutAt({ line: 9, column: 30 }, 'one literal, glue removed', 2000);
  await stage.caption('The plus sign and the quotes are gone', {
    duration: 2600,
  });
  await stage.pause(2200);

  await stage.runCommand('undo');
  await stage.pause(500);
}
