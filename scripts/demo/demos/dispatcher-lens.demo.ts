import { Stage } from '../lib/stage';

/**
 * Demo: Dispatcher lens (KJ-019). ~11 s.
 *
 * One beat: scroll a coroutine-heavy file and READ which thread each
 * block runs on — IO badges in the margin — then the two soft warnings
 * land: a View touched off-Main, a network call ON Main.
 *
 * WOW: "⚠ accès View hors Main" appears exactly where the ANR would be.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/DispatcherLensDemo.kt',
    { line: 27, column: 7 },
  );
  await stage.pause(1200);
  await stage.assertDecorations('badges dispatcher', 'dispatcherLens', 3);

  await stage.caption('Which thread runs this? The margin says so', {
    duration: 2400,
  });
  await stage.dwellOn({ line: 27, column: 7 }, 1400);

  // Ligne 34 (0-idx) = binding.title.setText(data) dans le bloc IO.
  void stage.calloutAt({ line: 32, column: 20 }, 'View touched on IO', 2200);
  await stage.dwellOn({ line: 32, column: 20 }, 1800);

  // Ligne 46 = api.fetchPokemon(150) dans launch(Main).
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/DispatcherLensDemo.kt',
    { line: 45, column: 25, reveal: 'if-offscreen' },
  );
  void stage.calloutAt({ line: 45, column: 25 }, 'network call on Main', 2200);
  await stage.caption('ANR ingredients, flagged before you ship', {
    duration: 2600,
  });
  await stage.pause(2400);
}
