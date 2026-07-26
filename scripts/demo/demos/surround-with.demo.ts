import { Stage } from '../lib/stage';

/**
 * Demo: Surround with try/catch (KJ-006). ~11 s.
 *
 * One beat: two risky lines get wrapped in a try/catch with perfect
 * re-indentation, cursor parked in the catch — Cmd+Alt+T energy.
 *
 * WOW: the block folds itself around the selection.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g1edition/SurroundWithDemo.kt',
    { line: 17, column: 9 },
  );
  await stage.pause(1100);

  // Lignes 18-19 (0-idx) : le fetch + le log à envelopper.
  await stage.selectLines(17, 18);
  await stage.caption('Two risky lines, selected', { duration: 2000 });
  await stage.pause(600);

  // Le handler applique le gabarit sur la sélection de l'éditeur actif :
  // uri/range ne servent que pour la code action, on passe undefined
  // (envoyer des objets vscode par-dessus le pont fait tomber l'hôte).
  await stage.runCommand(
    'kotlin-jump.surroundWith.apply',
    undefined,
    undefined,
    'tryCatch',
  );
  // Indentation incluse dans l'assertion : le bloc DOIT hériter des
  // 8 espaces du corps de scenarios(), sinon l'enregistrement échoue
  // (régression filmée le 25/07 : try { posé à la colonne 1).
  await stage.assertText('bloc try/catch indente', '        try {');
  await stage.assertText('corps reindente', '            val fetched');
  await stage.assertText('catch indente', '        } catch (e: Exception) {');
  await stage.pause(600);

  await stage.caption('try/catch wrapped, indentation intact', {
    duration: 2600,
  });
  await stage.pause(2400);

  await stage.runCommand('undo');
  await stage.pause(500);
}
