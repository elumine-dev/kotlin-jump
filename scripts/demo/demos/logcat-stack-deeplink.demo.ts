import * as path from 'node:path';
import { Stage } from '../lib/stage';

/**
 * Demo: Logcat → click stack frame → editor opens at exact line.
 *
 * Marketplace wow factor: a developer sees a crash in Logcat, clicks the
 * stack frame, and the editor jumps straight to the source. No manual
 * grep, no file picker, no IDE switch. ~12 s, fixture-driven so no real
 * Android device is required to record the demo.
 *
 * Beats:
 *   0–1 s   "Crash. Click. Open." caption
 *   1–3 s   Open MainActivity.kt (where the crash will land), open Logcat panel
 *   3–6 s   Replay the fixture; FATAL EXCEPTION arrives in red
 *   6–8 s   Highlight the MainActivity.onCreate frame
 *   8–10 s  Click → editor jumps to MainActivity.kt:42
 *   10–12 s "Stack frames are real hyperlinks." closer
 */

export const estimatedDurationMs = 12_500;

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'crash-mainactivity.log');
const FRAME_MATCHER = { tag: 'AndroidRuntime', messageContains: 'MainActivity.onCreate' };

export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();
  await stage.showStatusBar();   // the throughput pill should be visible

  // Beat 1 — caption sets expectation.
  void stage.caption('Crash. Click. Open.', { duration: 1000 });

  // Beat 2 — open the source file the click will land on, open the panel.
  await stage.openFile(
    'src/main/kotlin/com/example/app/MainActivity.kt',
    { line: 41, column: 0 },   // 0-indexed → line 42 in the editor gutter
  );
  await stage.pause(300);
  await stage.runCommand('kotlinJump.logcat.show');
  await stage.pause(900);

  // Beat 3 — replay the captured crash log through the parser.
  await stage.runCommand('kotlinJump.logcat._streamFixture', FIXTURE);
  await stage.caption('Crash hits Logcat in real time.', { duration: 2400 });

  // Beat 4 — flash the frame the demo is about to click on.
  await stage.pause(1400);
  await stage.runCommand('kotlinJump.logcat._demoFlashFrame', FRAME_MATCHER, 0);
  await stage.pause(700);

  // Beat 5 — click and let the editor land. waitForEditor blocks until the
  // active editor matches the expected file:line, so the dwell after this
  // is guaranteed to capture the cursor on its target.
  await stage.runCommand('kotlinJump.logcat._demoClickFrame', FRAME_MATCHER, 0);
  await stage.waitForEditor('MainActivity.kt', 41);
  await stage.dwellOn({ line: 41 }, 800);

  // Beat 6 — closer caption.
  await stage.caption('Stack frames are real hyperlinks.', { duration: 2400 });
}
