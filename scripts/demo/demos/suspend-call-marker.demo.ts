import { Stage } from '../lib/stage';

/**
 * Demo: Suspend Call Marker + Dispatcher badges — spot every pause
 * point and every thread switch without leaving the editor.
 *
 * Why it matters: inside a coroutine, a `suspend` call YIELDS the
 * thread — everything after it might run much later, maybe on a
 * different dispatcher. Miss one and you can accidentally block the
 * UI thread or race with your own code. Kotlin Jump tags every
 * suspend call with ⚡ and every `withContext` / `launch(Dispatcher…)`
 * with 🧵 / 🖥 / ⚙ so the control flow is visible at a glance.
 *
 * Story, starting from `savePokemon`:
 *   1. Land on the `suspend fun savePokemon(...)` declaration.
 *   2. Scroll down through the call-site block to see ⚡ on every
 *      suspend call + dispatcher badges on the context switches.
 *   3. Closer ties it to the WHY: never ship a blocked UI.
 *
 * ~14 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Beat 1: savePokemon declaration ─────────────────────────────────
  // CoroutinesDemo.kt line 57 (0-idx) = line 58 (1-idx):
  //   `suspend fun savePokemon(pokemon: Pokemon) = withContext(Dispatchers.IO) { ... }`
  // `suspend` keyword + `withContext(Dispatchers.IO)` → the function
  // yields AND switches to the IO dispatcher. Perfect starting point.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/CoroutinesDemo.kt',
    { line: 57, column: 4 },
  );
  await stage.dwellOn({ line: 57, column: 4 }, 1000);
  await stage.caption('`suspend` means: this call might pause. For how long?', {
    duration: 2600,
  });

  // ── Beat 2: Scroll into the call-site block ─────────────────────────
  // `callSitesWithSuspendMarkers` at line 110 (1-idx) = 109 (0-idx).
  // Lines 113-121 are the dense ⚡ markers on every call in the
  // coroutine body.
  await stage.scrollThrough({
    fromLine:   57,
    toLine:     113,
    column:     8,
    durationMs: 1800,
  });
  await stage.dwellOn({ line: 113, column: 8 }, 700);
  await stage.caption('⚡ marks every pause point. 6 suspends in 8 lines here.', {
    duration: 2600,
  });

  // ── Beat 3: Scroll further to the nested-dispatcher block ───────────
  // `nestedDispatchers` at line 127 (1-idx) = 126 (0-idx). Dispatcher
  // badges 🧵 IO / ⚙ Default / 🖥 Main show WHERE each block runs.
  await stage.scrollThrough({
    fromLine:   113,
    toLine:     130,
    column:     4,
    durationMs: 1400,
  });
  await stage.dwellOn({ line: 130 }, 800);
  await stage.caption('Badges tell you the thread: 🧵 IO, 🖥 Main, ⚙ Default.', {
    duration: 2800,
  });

  // ── Beat 4: Why it matters ──────────────────────────────────────────
  await stage.caption('Know your pauses. Know your threads. Before the UI freezes.', {
    duration: 3000,
  });
}
