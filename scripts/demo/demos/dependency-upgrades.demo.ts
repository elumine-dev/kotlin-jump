import * as path from 'path';
import * as vscode from 'vscode';
import { Stage } from '../lib/stage';

/**
 * Demo: dependency upgrades (KJ-082). ~13 s.
 *
 * The catalog opens and six versions are already underlined, each with its
 * newer version at the end of the line: no Gradle run, no sync. The hover on
 * retrofit says how far behind it is and when the latest shipped. The quick
 * fix on the shared `compose` entry says four libraries move before anyone
 * clicks. Then every patch bump in the file goes in one gesture.
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

  // The hover on retrofit: three versions behind, the latest shipped in May 2025.
  void stage.calloutAt({ line: 19, column: 14 }, '3 versions behind, published May 2025', 1800);
  await stage.dwellOn({ line: 19, column: 14 }, 1400);
  await stage.assertHover('retrofit hover', { line: 19, column: 14 }, 'versions behind');
  await stage.pause(500);

  await stage.caption('Hover: how far behind, and when the latest shipped', { duration: 2200 });

  // The shared entry: the menu shows "4 libraries move" before the click.
  await stage.openFile('gradle/libs.versions.toml', { line: 15, column: 13, reveal: 'if-offscreen' });
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'never' }).then(() => {}, () => {});
  await stage.pause(1600);
  await stage.runCommand('acceptSelectedCodeAction');
  await stage.pause(400);
  if (!(vscode.window.activeTextEditor?.document.getText() ?? '').includes('compose = "1.7.0"')) {
    // The menu was shown; if its acceptance lost the focus, the same action is applied directly.
    await stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'first' });
  }
  await stage.assertText('compose bumped', 'compose = "1.7.0"');

  await stage.caption('One shared version, four libraries move together', { duration: 2400 });
  await stage.pause(1400);

  // Every patch bump of the file: the menu shows the entry, the apply goes
  // through the command with the confirmation answered for the recording.
  await stage.openFile('gradle/libs.versions.toml', { line: 11, column: 15, reveal: 'if-offscreen' });
  await stage.pause(400);
  void stage.runCommand('editor.action.codeAction', { kind: 'quickfix', apply: 'never' }).then(() => {}, () => {});
  await stage.pause(700);
  await stage.runCommand('selectNextCodeAction').catch(() => {});
  await stage.pause(1200);
  await stage.runCommand('hideCodeActionWidget').catch(() => {});
  const file = vscode.window.activeTextEditor!.document.uri.fsPath;
  await stage.runCommand('kotlin-jump.applyDependencyUpgrades', file, 'patch', { confirmed: true });
  await stage.assertText('navigation patched', 'navigation = "2.7.7"');
  await stage.assertText('material3 patched', 'compose-material3 = "1.2.1"');

  await stage.caption('Every patch bump in the file, one confirmation', { duration: 2600 });
  await stage.pause(1800);

  // Back to the recorded state: two edits, two undos, then the disk copy is checked.
  await stage.runCommand('undo');
  await stage.pause(300);
  await stage.runCommand('undo');
  await stage.pause(400);
  await stage.restoreFixtures();
}
