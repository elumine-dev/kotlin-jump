import { Stage } from '../lib/stage';

/**
 * Demo: UDF X-Ray (KJ-014). ~11 s.
 *
 * One beat: every state property in a ViewModel carries its own census
 * — how many places write it, how many read it — right above the
 * declaration. No Find Usages, no mental sorting.
 *
 * WOW: « ✎ 3 écritures · 👁 2 lecteurs » on a StateFlow, and one of the
 * writes is indirect (through a helper).
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 23 (0-idx) = private val _hp = MutableStateFlow(100)
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/UdfXrayViewModel.kt',
    { line: 23, column: 17 },
  );
  await stage.pause(1200);
  await stage.assertCodeLens('lens ecritures/lecteurs', 3);

  await stage.caption('Who writes this state? Who reads it?', {
    duration: 2400,
  });
  void stage.calloutAt({ line: 23, column: 0 }, 'writes and readers', 2200);
  await stage.dwellOn({ line: 23, column: 17 }, 1600);

  // Le SharedFlow d'événements, deux propriétés plus bas.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/UdfXrayViewModel.kt',
    { line: 31, column: 17, reveal: 'if-offscreen' },
  );
  await stage.dwellOn({ line: 31, column: 17 }, 1400);

  await stage.caption('Writers and readers, answered above the field', {
    duration: 2600,
  });
  await stage.pause(2200);
}
