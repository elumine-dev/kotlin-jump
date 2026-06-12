/**
 * E2E — Sealed when coverage CodeLens (real VS Code, real workspace).
 *
 * Drives the feature end to end through the public CodeLens API:
 *   1. lenses render with the right counts on SealedWhenDemo.kt
 *   2. clicking an incomplete lens (= executing its command) inserts the
 *      missing branches with kind-aware spelling
 *   3. the lens flips to ✓ after the edit
 *   4. the config toggle removes the lenses
 *
 * Run with: npm run test:integration
 * Watch the steps in the "Kotlin Jump" output channel ([SealedWhen] lines).
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';

const DEMO_ROOT = path.join(__dirname, '..', '..', 'test', 'kotlin-jump-demo');
const DEMO_FILE = 'src/main/kotlin/com/example/demo/SealedWhenDemo.kt';

function demoUri(relativePath: string): vscode.Uri {
  return vscode.Uri.file(path.join(DEMO_ROOT, relativePath));
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

async function waitForLenses(
  uri: vscode.Uri,
  predicate: (lenses: vscode.CodeLens[]) => boolean,
  timeoutMs = 30_000,
): Promise<vscode.CodeLens[]> {
  const deadline = Date.now() + timeoutMs;
  let last: vscode.CodeLens[] = [];
  while (Date.now() < deadline) {
    last = (await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
      200,
    )) ?? [];
    if (predicate(last)) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(
    `waitForLenses timed out after ${timeoutMs}ms. Last titles: ${last.map(l => l.command?.title).join(' | ')}`,
  );
}

function findLens(lenses: vscode.CodeLens[], pattern: RegExp): vscode.CodeLens | undefined {
  return lenses.find(l => l.command?.title && pattern.test(l.command.title));
}

suite('E2E — Sealed when coverage (real VS Code)', function () {
  this.timeout(90_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
  });

  suiteTeardown(async () => {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    await cfg.update('sealedWhenCoverage', undefined, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── E2E-SW-1 : when exhaustif sur sealed → ✓ 3/3 branches ───────────────

  test('E2E-SW-1 — describeResult affiche ✓ 3/3 branches', async () => {
    const uri = demoUri(DEMO_FILE);
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => !!findLens(ls, /✓ 3\/3 branches/));
    const lens = findLens(lenses, /✓ 3\/3 branches/)!;
    assert.ok(lens, 'lens ✓ 3/3 manquante');
  });

  // ─── E2E-SW-2 : when exhaustif sur enum → ✓ 4/4 branches ─────────────────

  test('E2E-SW-2 — weatherEmoji (enum) affiche ✓ 4/4 branches', async () => {
    const uri = demoUri(DEMO_FILE);
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => !!findLens(ls, /✓ 4\/4 branches/));
    assert.ok(findLens(lenses, /✓ 4\/4 branches/), 'lens enum ✓ 4/4 manquante');
  });

  // ─── E2E-SW-3 : incomplet avec else → lens informative ───────────────────

  test('E2E-SW-3 — incompleteResult affiche "else covers 1 remaining: Draw"', async () => {
    const uri = demoUri(DEMO_FILE);
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => !!findLens(ls, /else covers 1 remaining: Draw/));
    assert.ok(findLens(lenses, /✓ else covers 1 remaining: Draw/), 'lens else-covers manquante');
  });

  // ─── E2E-SW-4 : clic sur la lens ⚠ → insertion de la branche manquante ───

  test('E2E-SW-4 — la lens ⚠ 2/3 insère SyncState.Syncing -> TODO() puis passe à ✓ 3/3', async () => {
    const uri = demoUri(DEMO_FILE);
    const doc = await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => !!findLens(ls, /⚠ 2\/3 branches, missing: Syncing/));
    const lens = findLens(lenses, /⚠ 2\/3 branches, missing: Syncing/)!;
    assert.strictEqual(lens.command!.command, 'kotlin-jump.addMissingWhenBranches');

    // Execute the lens command — same path as a user click.
    await vscode.commands.executeCommand(
      lens.command!.command,
      ...(lens.command!.arguments ?? []),
    );

    // The inserted branch: bare name (data object — no `is`), file's
    // qualification style (SyncState. prefix), TODO() body.
    const text = doc.getText();
    assert.ok(
      /\n\s+SyncState\.Syncing -> TODO\(\)\n/.test(text),
      `branche insérée introuvable. Extrait: …${text.slice(-400)}`,
    );
    assert.ok(!/is SyncState\.Syncing/.test(text), 'un data object ne doit pas être préfixé par `is`');

    // The lens recomputes on the new document version.
    await waitForLenses(uri, ls => !!findLens(ls, /✓ 3\/3 branches/));

    // Leave the file as we found it (the edit is only in the buffer).
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('workbench.action.files.revert');
    assert.ok(!/SyncState\.Syncing -> TODO\(\)/.test(doc.getText()), 'revert raté — le buffer garde l’insertion');
  });

  // ─── E2E-SW-5 : toggle config off → plus aucune lens de couverture ───────

  test('E2E-SW-5 — kotlinJump.sealedWhenCoverage=false retire les lenses', async () => {
    const uri = demoUri(DEMO_FILE);
    await openDocument(uri);
    const cfg = vscode.workspace.getConfiguration('kotlinJump');

    await cfg.update('sealedWhenCoverage', false, vscode.ConfigurationTarget.Workspace);
    await waitForLenses(uri, ls => !findLens(ls, /branches/));

    await cfg.update('sealedWhenCoverage', undefined, vscode.ConfigurationTarget.Workspace);
    await waitForLenses(uri, ls => !!findLens(ls, /✓ 3\/3 branches/));
  });
});
