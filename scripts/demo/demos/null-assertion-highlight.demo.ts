import { Stage } from '../lib/stage';

/**
 * Demo: Null Assertion Highlight — every `!!` operator highlighted in
 * amber so dangerous unwraps stand out at a glance.
 *
 * Simple but useful — `!!` is one of the most common sources of
 * NullPointerException in Kotlin, and seeing them visually flagged
 * during code review is a real win.
 *
 * Narrative: open the demo file, scroll. Pure ambient. ~7 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Open NullSafetyDemo.kt at line 19 (1-idx) = line 18 (0-idx) —
  // first function with a `!!`. The highlighting is subtle: amber
  // tint on the `!!` tokens themselves.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/NullSafetyDemo.kt',
    { line: 18, column: 0 },
  );
  await stage.pause(2200);
  // Question caption — primes the viewer to scan for the danger marks.
  await stage.caption('Where are the dangerous unwraps in this file?', {
    duration: 2800,
  });

  // Scroll through the variants: assignments, conditions, function
  // calls. Each section has multiple `!!` so the highlighting
  // pattern is reinforced.
  await stage.scrollThrough({
    fromLine:   18,
    toLine:     65,
    column:     4,
    durationMs: 3000,
  });
  await stage.dwellOn({ line: 65 }, 1200);

  // Answer caption — declarative, names the value.
  await stage.caption('Every `!!` lit up. Spot NPE risks at a glance. ⚠️', {
    duration: 2800,
  });
}
