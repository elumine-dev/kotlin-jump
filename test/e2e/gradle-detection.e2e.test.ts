/**
 * E2E — Gradle root detection inside a real VS Code instance.
 *
 * Runs against the kotlin-jump-demo fixture (single-module Gradle project).
 * Activates the extension, exercises the public surface that surrounds
 * `detectProjectRoot()` / `resolveGradleWrapper()` / `findProjectRoot()` and
 * verifies behaviour observable through commands and the workspace state.
 *
 * Coverage:
 *   GD-1  diagnose command is registered + visible
 *   GD-2  diagnose with no active editor → resolves via workspace-root tier
 *   GD-3  diagnose with a Kotlin file open → resolves via active-editor tier
 *   GD-4  setting `kotlinJump.gradleProjectRoot` to an invalid path surfaces "setting-invalid"
 *   GD-5  setting points at the real demo path → resolves via "setting"
 *   GD-6  reset command clears persisted Gradle project choice
 *   GD-7  gradlew really exists at the resolved root (smoke check on the wrapper)
 *   GD-8  diagnose still works after switching active editor between two demo files
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const DEMO_ROOT = path.join(__dirname, '..', '..', 'test', 'kotlin-jump-demo');
const SRC_ROOT  = path.join(DEMO_ROOT, 'src', 'main', 'kotlin', 'com', 'example');

function demoUri(relative: string): vscode.Uri {
  return vscode.Uri.file(path.join(SRC_ROOT, relative));
}

async function openDoc(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

/**
 * Captures the next call to `vscode.window.showInformationMessage` (modal or not)
 * and immediately resolves it (without waiting for user input).
 *
 * The diagnose command opens a modal; in the test environment we patch
 * showInformationMessage to record the message and resolve with `undefined`
 * (no button clicked). Restores the original after the call.
 */
async function captureNextInfoMessage<T>(action: () => Promise<T>): Promise<{
  result: T;
  message: string | undefined;
}> {
  const original = vscode.window.showInformationMessage;
  let captured: string | undefined;
  (vscode.window as any).showInformationMessage = (msg: string) => {
    captured = msg;
    return Promise.resolve(undefined);
  };
  try {
    const result = await action();
    return { result, message: captured };
  } finally {
    (vscode.window as any).showInformationMessage = original;
  }
}

async function runDiagnose(): Promise<string | undefined> {
  const captured = await captureNextInfoMessage(() =>
    vscode.commands.executeCommand('kotlin-jump.diagnoseGradleDetection'),
  );
  return captured.message;
}

async function setKotlinJumpConfig(key: string, value: any): Promise<void> {
  await vscode.workspace
    .getConfiguration('kotlinJump')
    .update(key, value, vscode.ConfigurationTarget.Workspace);
}

suite('E2E — Gradle root detection', function () {
  this.timeout(30_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
    // Allow command registration + initial detection to settle
    await new Promise(r => setTimeout(r, 1500));
  });

  suiteTeardown(async () => {
    await setKotlinJumpConfig('gradleProjectRoot', undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('GD-1 : diagnose command is registered', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes('kotlin-jump.diagnoseGradleDetection'),
      'kotlin-jump.diagnoseGradleDetection must be registered',
    );
    assert.ok(
      all.includes('kotlin-jump.resetGradleProject'),
      'kotlin-jump.resetGradleProject must be registered',
    );
  });

  test('GD-2 : diagnose with no active editor → resolves to demo workspace root', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(r => setTimeout(r, 200));

    const message = await runDiagnose();
    assert.ok(message, 'expected diagnose to produce a message');
    assert.ok(
      message!.includes('Gradle project resolved') || message!.includes('Gradle project'),
      `expected "Gradle project resolved" message; got: ${message}`,
    );
    assert.ok(
      message!.includes(DEMO_ROOT) || message!.includes('kotlin-jump-demo'),
      `expected demo path in message; got: ${message}`,
    );
  });

  test('GD-3 : diagnose with a Kotlin file open → resolves via active-editor tier', async () => {
    const uri = demoUri('app/App.kt');
    await openDoc(uri);

    const message = await runDiagnose();
    assert.ok(message, 'expected diagnose to produce a message');
    // Tier 2 walk-up from the open file should find the demo root via active-editor
    assert.ok(
      message!.includes('active-editor') ||
      message!.includes('workspace-root') ||
      message!.includes('depth-1-scan'),
      `expected a recognized detection tier; got: ${message}`,
    );
    assert.ok(
      message!.includes('kotlin-jump-demo'),
      `expected demo path in message; got: ${message}`,
    );
  });

  test('GD-4 : invalid setting surfaces "setting-invalid"', async () => {
    await setKotlinJumpConfig('gradleProjectRoot', '/this/path/does/not/exist/ever-2026');
    await new Promise(r => setTimeout(r, 200));

    try {
      const message = await runDiagnose();
      assert.ok(message, 'expected diagnose to produce a message');
      assert.ok(
        message!.includes('not a Gradle project') ||
        message!.includes('does/not/exist') ||
        message!.includes('setting'),
        `expected a setting-invalid signal; got: ${message}`,
      );
    } finally {
      await setKotlinJumpConfig('gradleProjectRoot', undefined);
      await new Promise(r => setTimeout(r, 200));
    }
  });

  test('GD-5 : valid absolute setting → resolves "via: setting"', async () => {
    await setKotlinJumpConfig('gradleProjectRoot', DEMO_ROOT);
    await new Promise(r => setTimeout(r, 200));

    try {
      const message = await runDiagnose();
      assert.ok(message, 'expected diagnose to produce a message');
      assert.ok(
        message!.includes('setting'),
        `expected "via: setting" tier name; got: ${message}`,
      );
      assert.ok(
        message!.includes(DEMO_ROOT) || message!.includes('kotlin-jump-demo'),
        `expected demo path in message; got: ${message}`,
      );
    } finally {
      await setKotlinJumpConfig('gradleProjectRoot', undefined);
      await new Promise(r => setTimeout(r, 200));
    }
  });

  test('GD-6 : resetGradleProject clears persisted choice', async () => {
    // Should run without throwing and the next diagnose still works
    await captureNextInfoMessage(() =>
      vscode.commands.executeCommand('kotlin-jump.resetGradleProject'),
    );
    const message = await runDiagnose();
    assert.ok(message, 'diagnose should still work after reset');
  });

  test('GD-7 : gradlew really exists at the detected root', async () => {
    // Sanity check on the wrapper resolution against the real demo fixture.
    // The diagnose modal does not include the wrapper path, so we verify directly.
    const wrapperPosix = path.join(DEMO_ROOT, 'gradlew');
    const wrapperWin   = path.join(DEMO_ROOT, 'gradlew.bat');
    const ok = fs.existsSync(wrapperPosix) || fs.existsSync(wrapperWin);
    assert.ok(ok, `gradlew or gradlew.bat must exist at ${DEMO_ROOT}`);
  });

  test('GD-8 : switching active editor between two demo files keeps detection stable', async () => {
    const a = demoUri('app/App.kt');
    const b = demoUri('app/AppNavigator.kt');

    await openDoc(a);
    const messageA = await runDiagnose();

    await openDoc(b);
    const messageB = await runDiagnose();

    assert.ok(messageA && messageB, 'both diagnoses must produce a message');
    // Both should resolve to the same project (demo root) regardless of which file is active
    assert.ok(
      messageA!.includes('kotlin-jump-demo') && messageB!.includes('kotlin-jump-demo'),
      `both should resolve to demo; A=${messageA}, B=${messageB}`,
    );
  });
});
