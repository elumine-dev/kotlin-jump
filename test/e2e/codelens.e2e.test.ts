import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';

const DEMO_ROOT = path.join(__dirname, '..', '..', 'test', 'kotlin-jump-demo');

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
  while (Date.now() < deadline) {
    const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
      50,
    )) ?? [];
    if (predicate(lenses)) return lenses;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`waitForLenses timed out after ${timeoutMs}ms for ${uri.fsPath}`);
}

function hasTitle(lenses: vscode.CodeLens[], pattern: RegExp): boolean {
  return lenses.some(l => l.command?.title && pattern.test(l.command.title));
}

function findLens(lenses: vscode.CodeLens[], pattern: RegExp): vscode.CodeLens | undefined {
  return lenses.find(l => l.command?.title && pattern.test(l.command.title));
}

// Poll the active editor until it matches, instead of a fixed sleep: navigation
// can take longer than any single timeout, and earlier tests may leave the
// output channel focused. Returns whatever is active at the deadline so the
// caller's assertion produces a useful message.
async function waitForActiveEditor(
  predicate: (editor: vscode.TextEditor) => boolean,
  timeoutMs = 10_000,
): Promise<vscode.TextEditor | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = vscode.window.activeTextEditor;
    if (active && predicate(active)) return active;
    await new Promise(r => setTimeout(r, 100));
  }
  return vscode.window.activeTextEditor;
}

suite('E2E — CodeLens (real VS Code)', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    // Wait for extension to activate
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Restore settings
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    await cfg.update('overrideGutterIcons', undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update('codeLens', undefined, vscode.ConfigurationTarget.Workspace);
  });

  // ─── E2E-CL-1 : interface ApiService → ⬇ lens visible ───────────────────

  test('E2E-CL-1 — interface ApiService a un lens ⬇ N implementation(s)', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/ApiService.kt');
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => hasTitle(ls, /⬇/));
    assert.ok(
      hasTitle(lenses, /⬇\s+\d+\s+implementation/),
      `Aucun lens "⬇ N implementation" trouvé. Lenses: ${lenses.map(l => l.command?.title).join(', ')}`,
    );
  });

  // ─── E2E-CL-2 : interface ApiService → lens usages visible ───────────────

  test('E2E-CL-2 — interface ApiService a un lens N usages', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/ApiService.kt');
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => hasTitle(ls, /usage/));
    const usageLens = findLens(lenses, /\d+\s+usage/);
    assert.ok(
      usageLens,
      `Aucun lens "N usages" trouvé. Lenses: ${lenses.map(l => l.command?.title).join(', ')}`,
    );
  });

  // ─── E2E-CL-3 : goToClassImpl → navigue vers ApiServiceImpl ─────────────

  test('E2E-CL-3 — goToClassImpl navigue vers ApiServiceImpl', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/ApiService.kt');
    await openDocument(uri);

    await vscode.commands.executeCommand(
      'kotlin-jump.goToClassImpl',
      'ApiService',
      'com.example.data',
    );

    const active = await waitForActiveEditor(
      e => e.document.fileName.includes('ApiServiceImpl'),
    );
    assert.ok(active, 'Aucun éditeur actif après goToClassImpl');
    assert.ok(
      active.document.fileName.includes('ApiServiceImpl'),
      `Attendu ApiServiceImpl, obtenu: ${active.document.fileName}`,
    );
  });

  // ─── E2E-CL-4 : override ⬆ visible sur ApiServiceImpl ───────────────────

  test('E2E-CL-4 — ApiServiceImpl.fetchUser a un lens ⬆ overrides', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/ApiServiceImpl.kt');
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => hasTitle(ls, /⬆/));
    assert.ok(
      hasTitle(lenses, /⬆\s+overrides/),
      `Aucun lens "⬆ overrides" trouvé. Lenses: ${lenses.map(l => l.command?.title).join(', ')}`,
    );
  });

  // ─── E2E-CL-5 : abstract class MoveStrategy → usages + implementations ──

  test('E2E-CL-5 — abstract class MoveStrategy a des lenses usages ET ⬇ implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/AbstractClassDemo.kt');
    await openDocument(uri);

    // Attendre les deux types de lenses
    const lenses = await waitForLenses(
      uri,
      ls => hasTitle(ls, /usage/) && hasTitle(ls, /⬇/),
    );

    assert.ok(hasTitle(lenses, /\d+\s+usage/), 'Lens usages manquant sur MoveStrategy');
    assert.ok(hasTitle(lenses, /⬇\s+\d+\s+implementation/), 'Lens ⬇ implementations manquant sur MoveStrategy');
  });

  // ─── E2E-CL-6 : classe concrète → PAS de lens ⬇ ─────────────────────────

  test('E2E-CL-6 — classe concrète ApiServiceImpl n\'a PAS de lens ⬇', async () => {
    const uri = demoUri('src/main/kotlin/com/example/data/ApiServiceImpl.kt');
    await openDocument(uri);

    // Attendre que les lenses chargent (au moins ⬆ doit apparaître)
    const lenses = await waitForLenses(uri, ls => ls.length > 0);

    const implLens = findLens(lenses, /⬇\s+\d+\s+implementation/);
    assert.ok(!implLens, `Lens ⬇ inattendu sur classe concrète: ${implLens?.command?.title}`);
  });

  // ─── E2E-CL-7 : setting overrideGutterIcons=false → 0 lens ⬇ ────────────

  test('E2E-CL-7 — overrideGutterIcons:false supprime les lens ⬇', async () => {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    await cfg.update('overrideGutterIcons', false, vscode.ConfigurationTarget.Workspace);

    try {
      const uri = demoUri('src/main/kotlin/com/example/data/ApiService.kt');
      await openDocument(uri);

      // Attendre que les lenses se rechargent (usages peuvent encore apparaître)
      await new Promise(r => setTimeout(r, 3000));

      const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        uri,
        50,
      )) ?? [];

      const downLens = findLens(lenses, /⬇/);
      assert.ok(!downLens, `Lens ⬇ ne devrait pas exister quand overrideGutterIcons=false: ${downLens?.command?.title}`);
    } finally {
      await cfg.update('overrideGutterIcons', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  // ─── E2E-CL-8 : setting codeLens=false → 0 lens usages ──────────────────

  test('E2E-CL-8 — codeLens:false supprime les lens usages', async () => {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    await cfg.update('codeLens', false, vscode.ConfigurationTarget.Workspace);

    try {
      const uri = demoUri('src/main/kotlin/com/example/data/ApiService.kt');
      await openDocument(uri);

      await new Promise(r => setTimeout(r, 3000));

      const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        uri,
        50,
      )) ?? [];

      const usageLens = findLens(lenses, /\d+\s+usage/);
      assert.ok(!usageLens, `Lens usages ne devrait pas exister quand codeLens=false: ${usageLens?.command?.title}`);
    } finally {
      await cfg.update('codeLens', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  // ─── E2E-CL-9 : sealed class CombatResult → ⬇ 3 implementations ─────────

  test('E2E-CL-9 — sealed class CombatResult a un lens ⬇ 3 implementations', async () => {
    const uri = demoUri('src/main/kotlin/com/example/demo/SealedWhenDemo.kt');
    await openDocument(uri);

    const lenses = await waitForLenses(uri, ls => hasTitle(ls, /⬇\s+3\s+implementation/));
    assert.ok(
      hasTitle(lenses, /⬇\s+3\s+implementation/),
      `Attendu "⬇ 3 implementations". Lenses: ${lenses.map(l => l.command?.title).join(', ')}`,
    );
  });
});
