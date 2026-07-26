import { Stage } from '../lib/stage';

/**
 * Demo: Resource usage badges (KJ-021). ~11 s.
 *
 * One beat: open strings.xml and READ, on every line, how many times
 * each string is actually used. The dead ones gray out by themselves.
 *
 * WOW: « 0 usages » sitting right next to a string nobody dares delete.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 137 (0-idx) = <string name="battle_cry"> — utilisée 2×.
  await stage.openFile('src/main/res/values/strings.xml', { line: 137, column: 20 });
  // Scan du workspace + pose des décorations.
  await stage.pause(1600);
  await stage.assertDecorations('badges usages res', 'resourceUsageBadges', 5);

  await stage.caption('Which of these strings are still used?', {
    duration: 2000,
  });
  await stage.dwellOn({ line: 137, column: 60 }, 900);

  // Ligne 143 (0-idx) = unused_promo_banner — 0 usages, grisée.
  await stage.openFile('src/main/res/values/strings.xml', {
    line: 143,
    column: 20,
    reveal: 'if-offscreen',
  });
  await stage.assertBadgeReadable('badge 0 usages dans le cadre', 143, 10);
  void stage.calloutAt({ line: 143, column: 55 }, '0 usages, dead weight', 2000);
  await stage.dwellOn({ line: 143, column: 62 }, 1200);

  await stage.caption('Usage counts live in the XML', {
    duration: 2600,
  });
  await stage.pause(2000);
}
