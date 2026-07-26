import { Stage } from '../lib/stage';

/**
 * Demo: Extract string resource (KJ-005). ~12 s.
 *
 * One beat: a hardcoded UI string moves itself to strings.xml and comes
 * back as `stringResource(R.string.…)` — name generated, XML escaped,
 * file saved.
 *
 * WOW: one action touches two files and picks the right call form for
 * the @Composable context.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 18 (0-idx) = Text("Battle ready!")
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g2resources/ExtractStringResourceDemo.kt',
    { line: 18, column: 15 },
  );
  await stage.pause(1000);

  await stage.caption('Hardcoded string, one action from being a resource', {
    duration: 2200,
  });
  await stage.dwellOn({ line: 18, column: 15 }, 900);

  await stage.runCommand('editor.action.codeAction', {
    kind: 'refactor.extract',
    apply: 'first',
  });
  await stage.assertText('appel stringResource', 'stringResource(R.string.');
  await stage.pause(700);

  void stage.calloutAt({ line: 18, column: 40 }, 'stringResource, in place', 2000);
  await stage.pause(1600);

  // La preuve côté XML, à l'écran : ouvrir strings.xml et montrer l'entrée
  // créée. Sans ce plan, le spectateur doit croire la caption sur parole
  // (rien ne montrait le fichier). L'entrée s'insère devant </resources>,
  // ligne 152 (0-idx) dans la fixture au repos.
  await stage.openFile('src/main/res/values/strings.xml', { line: 152, column: 4 });
  await stage.assertText(
    'entree creee dans strings.xml',
    '<string name="battle_ready">Battle ready!</string>',
  );
  void stage.calloutAt({ line: 152, column: 12 }, 'created and escaped', 2200);
  await stage.caption('The string moves to XML, properly escaped', {
    duration: 2400,
  });
  await stage.pause(1800);

  // L'action touche DEUX fichiers (le .kt et strings.xml) et `undo` ne
  // défait que l'éditeur actif. On réécrit explicitement l'état d'origine :
  // déterministe, contrairement à la pile d'undo.
  await stage.runCommand('undo');
  await stage.pause(300);
  await stage.restoreFixtures();
  await stage.pause(400);
}
