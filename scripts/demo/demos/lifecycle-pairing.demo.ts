import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: Lifecycle pairing (KJ-016). ~12 s.
 *
 * One beat, told as a story: a listener acquired in onResume has no
 * release in onPause. The squiggly lands on the exact call, the hover
 * SPELLS OUT the leak, and the paired register/unregister right above
 * stays silent: the contrast is the feature.
 *
 * Révision 25/07 : l'ancienne demo montrait un squiggly minuscule et un
 * hover fugace, sans jamais dire ce que la feature vérifie. Le hover
 * (qui contient la phrase complète du diagnostic) est maintenant le
 * plan central, tenu à l'écran le temps de le lire.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 41 (0-idx) = requestLocationUpdates(gpsListener), l'orphelin.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g4runtime/LifecyclePairingDemo.kt',
    { line: 41, column: 12 },
  );
  await stage.pause(1100);
  await stage.assertDiagnostics('warning fuite lifecycle');

  await stage.caption('Acquired in onResume. Where is the release?', {
    duration: 2200,
  });
  await stage.dwellOn({ line: 41, column: 12 }, 900);

  // Le hover affiche la phrase complète du diagnostic : c'est LE plan.
  // (executeHoverProvider ne rapporte pas les diagnostics : on vérifie le
  // message via getDiagnostics, le widget hover le montre à l'écran.)
  await stage.assertVisible('message du diagnostic', () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) return false;
    return vscode.languages.getDiagnostics(uri)
      .some(d => d.message.includes('no release in onPause()'));
  });
  await stage.runCommand('editor.action.showHover');
  await stage.pause(2800);
  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});

  // Le contraste : la paire propre juste au-dessus ne déclenche rien.
  void stage.calloutAt({ line: 45, column: 9 }, 'the paired half: silent', 2200);
  await stage.dwellOn({ line: 45, column: 9 }, 1600);

  await stage.caption('Unpaired acquisitions get flagged before they leak', {
    duration: 2600,
  });
  await stage.pause(2200);
}
