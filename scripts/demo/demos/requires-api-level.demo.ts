import { Stage } from '../lib/stage';

/**
 * Demo: API-level Inlay Hints — the same live-update mechanism applied
 * to THREE distinct syntactic sites, so the viewer sees it's not a
 * one-trick provider:
 *   1. `@RequiresApi(24)` annotation — swap 24→33→999→24.
 *   2. `if (Build.VERSION.SDK_INT >= 33)` runtime guard — swap 33→26.
 *   3. `when { Build.VERSION.SDK_INT >= 34 -> … }` branch — swap 34→30.
 *
 * Story: a dev reads annotations AND runtime guards. Both get the
 * " // Android X.Y NomVersion" hint. Changing the literal — anywhere
 * — flips the hint within ~100 ms. The invalid-input beat (999) is
 * still used on site 1 to sell the provider's graceful fallback.
 *
 * WOW: one provider, many call shapes, all live. No LSP, no JVM.
 *
 * Narrative: Setup → Edit 1 (annotation, 24→33→999→24) → Scroll to
 * `sdkIntGuards` → Edit 2 (if-guard, 33→26→33) → Edit 3 (when branch,
 * 34→30→34) → Relief. ~22 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Setup: AnnotationsDemo at line 142 (1-idx) = line 141 (0-idx) =
  // first @RequiresApi(21). Pause long enough for the eye to register
  // 4-5 hints stacked.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/AnnotationsDemo.kt',
    { line: 141, column: 0 },
  );
  await stage.pause(2400);
  void stage.calloutAt({ line: 141, column: 17 }, 'API name', 2400);
  await stage.caption('What Android version is API 21? 24? 33?', {
    duration: 2800,
  });

  // Live edit 1: jump to a function whose @RequiresApi we'll mutate.
  // Line 148 (1-idx) = line 147 (0-idx) = `@RequiresApi(24)`. We retype
  // ONLY the digits (24 → 33) char-by-char so the viewer sees the line
  // mutate naturally — backspace, pause, type — and the inlay hint
  // re-renders after each keystroke (the provider's debounced window
  // catches up within ~100 ms, but the typing cadence is what sells
  // "live" to the eye).
  await stage.openFile(
    'src/main/kotlin/com/example/demo/AnnotationsDemo.kt',
    { line: 147, column: 0 },
  );
  await stage.pause(800);
  await stage.caption('Change the number → the hint updates live.', { duration: 2000 });
  await stage.typeReplace(147, '24', '33');
  // Longer dwell so the viewer reads "Tiramisu (13)" before we move on.
  await stage.pause(1600);

  // Live edit 2: change to an invalid level (999). Type the extra
  // digit so the three-char value 999 still looks hand-typed. The
  // provider's `apiLabel()` returns undefined for unknown levels →
  // hint disappears gracefully (no "API 999" stale label).
  await stage.typeReplace(147, '33', '999');
  await stage.pause(1400);
  await stage.caption('Unknown API → no hint. No noise, no stale info.', { duration: 2400 });

  // Restore: revert to @RequiresApi(24). The hint returns. Leaves
  // the annotation block clean before we move to the runtime guards.
  await stage.typeReplace(147, '999', '24');
  await stage.pause(1000);

  // ── Site 2: runtime guard in an `if` ────────────────────────────────
  // Scroll into `sdkIntGuards` (line 197 0-idx = 198 1-idx). The first
  // guard is `if (Build.VERSION.SDK_INT >= 33)`. Same provider, new
  // syntactic shape — the viewer learns "this isn't just for
  // annotations". 33 → 26 flips the hint from "Tiramisu (13)" to
  // "Oreo (8.0)".
  await stage.scrollThrough({
    fromLine:   147,
    toLine:     197,
    column:     4,
    durationMs: 2200,
  });
  await stage.dwellOn({ line: 197 }, 800);
  await stage.caption('Same live hint on a runtime `SDK_INT` guard.', {
    duration: 2400,
  });
  await stage.typeReplace(197, '>= 33', '>= 26');
  await stage.pause(1400);
  // Restore so the viewport returns to its baseline text.
  await stage.typeReplace(197, '>= 26', '>= 33');
  await stage.pause(800);

  // ── Site 3: `when` branch ───────────────────────────────────────────
  // Line 218 0-idx = 219 1-idx: `Build.VERSION.SDK_INT >= 34 -> println(...)`.
  // Same mutation style on a third shape. 34 → 30 flips the hint from
  // "Upside Down Cake (14)" to "Q (10)".
  await stage.scrollThrough({
    fromLine:   197,
    toLine:     218,
    column:     8,
    durationMs: 1400,
  });
  await stage.dwellOn({ line: 218 }, 700);
  await stage.caption('And on a `when` branch. One provider, every shape.', {
    duration: 2400,
  });
  await stage.typeReplace(218, '>= 34', '>= 30');
  await stage.pause(1400);
  // Restore — workspace clean for next recording.
  await stage.typeReplace(218, '>= 30', '>= 34');
  await stage.pause(800);

  await stage.caption('Live. Validated. Inline. Everywhere. ⚡', { duration: 2400 });
}
