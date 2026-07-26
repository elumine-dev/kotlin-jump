import { Stage } from '../lib/stage';

/**
 * Demo: Dependency usage badges (KJ-022). ~11 s.
 *
 * One beat: build.gradle.kts tells you which dependencies your code
 * actually imports — and which are pure APK weight.
 *
 * WOW: « 0 imports » on a library sitting in the build for months.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // Ligne 96 (0-idx) = implementation(libs.gson) — 0 imports.
  await stage.openFile('build.gradle.kts', { line: 96, column: 5 });
  await stage.pause(1600);
  await stage.assertDecorations('badges dependances', 'dependencyUsageBadges', 3);

  await stage.caption('Every dependency costs bytes. Which one earns it?', {
    duration: 2400,
  });
  await stage.dwellOn({ line: 96, column: 40 }, 1400);

  void stage.calloutAt({ line: 96, column: 40 }, '0 imports, removable', 2200);
  await stage.pause(1400);

  // Ligne 100 (0-idx) = implementation(libs.retrofit.core) — 1 import.
  await stage.openFile('build.gradle.kts', {
    line: 100,
    column: 5,
    reveal: 'if-offscreen',
  });
  void stage.calloutAt({ line: 100, column: 44 }, 'earns its place', 2000);
  await stage.caption('Dead dependencies, visible before the APK', {
    duration: 2600,
  });
  await stage.pause(2200);
}
