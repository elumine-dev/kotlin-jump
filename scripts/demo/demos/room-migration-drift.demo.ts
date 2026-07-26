import { Stage } from '../lib/stage';

/**
 * Demo: Room migration drift (KJ-020). ~12 s.
 *
 * One beat: a field added to an @Entity with no migration to back it —
 * the crash your users get on upgrade, flagged at edit time. Plus the
 * hole in the migration chain, right on the @Database.
 *
 * WOW: the warning lands on `nickname` before the app ever runs.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 28 (0-idx) = val nickname: String
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/RoomMigrationDemo.kt',
    { line: 28, column: 9 },
  );
  // Scan workspace-wide des entities + migrations.
  await stage.pause(1800);
  await stage.assertDiagnostics('warnings Room migration');

  await stage.caption('New field. Did anyone write the migration?', {
    duration: 2400,
  });
  void stage.calloutAt({ line: 28, column: 22 }, 'no ADD COLUMN anywhere', 2200);
  await stage.dwellOn({ line: 28, column: 22 }, 1400);

  // Ligne 44 (0-idx) = @Database(... version = 4 ...) — le trou 2→3.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/RoomMigrationDemo.kt',
    { line: 42, column: 1, reveal: 'if-offscreen' },
  );
  // Le diagnostic « trou de chaîne » est posé sur la ligne @Database :
  // c'est là que la flèche doit pointer, dans le cadre.
  void stage.calloutAt({ line: 42, column: 5 }, 'migration 2 to 3 missing', 2200);
  await stage.caption('The upgrade crash, caught while you type', {
    duration: 2600,
  });
  await stage.pause(2200);
}
