import * as path from 'path';
import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: dependency upgrades (KJ-082). ~12 s.
 *
 * The catalog opens and six versions are already underlined, each with its
 * newer version at the end of the line: no Gradle run, no sync. The hover on
 * retrofit says how far behind it is and when the latest shipped. The quick
 * fix on the shared `compose` entry says four libraries move before anyone
 * clicks, and the five other underlines stay where they are.
 *
 * Deterministic: the answers come from scripts/demo/fixtures/dependency-versions.json
 * through kotlin-jump._seedDependencyVersions, which only runs under
 * KJ_DEMO_MODE. No network, no cache written.
 *
 * WOW: the file lights up on open, and one entry moves four libraries.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  const repoRoot = path.resolve(process.env.KJ_DEMO_WORKSPACE ?? path.join(__dirname, '..', '..', '..', 'test', 'kotlin-jump-demo'), '..', '..');
  await stage.runCommand('kotlin-jump._seedDependencyVersions', path.join(repoRoot, 'scripts', 'demo', 'fixtures', 'dependency-versions.json'));

  await stage.openFile('gradle/libs.versions.toml', { line: 19, column: 13 });
  await stage.pause(900);
  await stage.assertDiagnostics('outdated versions', 6);
  await stage.assertDecorations('version badges', 'dependencyUpgrades', 6);
  await stage.assertBadgeReadable('retrofit badge', 19, '↑ 3.0.0'.length);

  await stage.caption('Six dependencies behind, known before any Gradle run', { duration: 2400 });

  // The hover on retrofit. `editor.action.showHover` is Cmd+K Cmd+I: the same
  // panel as a mouse hover, opened at the cursor, so it is on screen for sure.
  await stage.keystroke('⌘ + K  ⌘ + I', { label: 'Show Hover' });
  await stage.runCommand('editor.action.showHover');
  await stage.pause(1200);
  await stage.assertHover('retrofit hover', { line: 19, column: 14 }, 'versions behind');

  await stage.caption('The hover: 3 versions behind, latest published May 2025', { duration: 2200 });

  // The shared entry: the menu shows "4 libraries move" before the click.
  await stage.openFile('gradle/libs.versions.toml', { line: 15, column: 13, reveal: 'if-offscreen' });
  await stage.pause(300);
  void stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'never' }).then(() => {}, () => {});
  await stage.pause(1600);
  await stage.runCommand('acceptSelectedCodeAction');
  await stage.pause(300);
  if (!(vscode.window.activeTextEditor?.document.getText() ?? '').includes('compose = "1.7.0"')) {
    // The menu was shown; if its acceptance lost the focus, the same action is applied directly.
    await stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'first' });
  }
  await stage.assertText('compose bumped', 'compose = "1.7.0"');
  await stage.assertDecorations('the other badges stay', 'dependencyUpgrades', 5);

  await stage.caption('One shared version, four libraries move together', { duration: 2400 });
  await stage.pause(500);

  // Back to the recorded state: one edit, one undo, then the disk copy is checked.
  await stage.runCommand('undo');
  await stage.pause(300);
  await stage.restoreFixtures();
}
