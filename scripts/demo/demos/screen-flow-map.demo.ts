import { Stage } from '../lib/stage';

/**
 * Demo: Screen Flow Map (KJ-013) — the differentiator. ~13 s.
 *
 * One beat: a nav graph you've never seen becomes a map. Compose routes
 * AND legacy XML fragment graphs, merged, with orphan screens outlined
 * in red and deep-linked screens badged.
 *
 * WOW: the whole app's navigation, drawn from source, no build, no run.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g3navigation/NavGraphDemo.kt',
    { line: 21, column: 5 },
  );
  await stage.pause(1400);

  await stage.caption('Which screens does this app have? Where do they lead?', {
    duration: 2600,
  });
  await stage.pause(1000);

  await stage.runCommand('kotlin-jump.screenFlowMap');
  // Scan du workspace + rendu SVG de la webview.
  await stage.assertPanel('webview Screen Flow Map', 'Screen Flow');
  await stage.pause(2400);

  await stage.caption('Screen Flow Map, read from the sources', {
    duration: 3000,
  });
  await stage.pause(3200);
}
