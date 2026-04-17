import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';

const DEMO_ROOT = path.join(__dirname, '..', '..', 'test', 'kotlin-jump-demo');
const SRC_ROOT  = path.join(DEMO_ROOT, 'src', 'main', 'kotlin', 'com', 'example');

function demoUri(relative: string): vscode.Uri {
  return vscode.Uri.file(path.join(SRC_ROOT, relative));
}

// Open a file, set cursor at the given position, wait for the extension to process.
// Does NOT use the `selection` option in showTextDocument to avoid the L0 race;
// instead sets editor.selection after opening so the deferred push captures the
// right position.
async function placeAt(uri: vscode.Uri, line: number, character = 0): Promise<vscode.TextEditor> {
  const doc    = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos    = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);
  // 400 ms > any setTimeout(0) deferred push
  await new Promise(r => setTimeout(r, 400));
  return editor;
}

// Poll until the active editor matches the expected file + line, or timeout.
async function waitForEditor(
  expectedFile: string,
  expectedLine: number,
  timeoutMs = 6000,
): Promise<vscode.TextEditor> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = vscode.window.activeTextEditor;
    if (
      active &&
      active.document.fileName.includes(expectedFile) &&
      active.selection.active.line === expectedLine
    ) {
      return active;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  const active = vscode.window.activeTextEditor;
  throw new Error(
    `Timeout: expected ${expectedFile}:L${expectedLine} — ` +
    `got: ${active ? path.basename(active.document.fileName) + ':L' + active.selection.active.line : 'no editor'}`,
  );
}

// ── Suite ────────────────────────────────────────────────────────────────────

suite('E2E — Navigation History Back/Forward (real VS Code)', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
    // Let the indexer finish before running navigation tests
    await new Promise(r => setTimeout(r, 3000));
  });

  setup(async () => {
    // Clean slate: close all editors and reset history
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('kotlinJump.clearNavigationHistory');
    await new Promise(r => setTimeout(r, 400));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── NH-1 — Back restores the origin position after cross-file navigation ──

  test('NH-1 — back restaure le fichier et la ligne d\'origine', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3, 18);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4, 20);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');

    const editor = await waitForEditor('ApiService.kt', 3);
    assert.ok(
      editor.document.fileName.endsWith('ApiService.kt'),
      `Attendu ApiService.kt, obtenu ${path.basename(editor.document.fileName)}`,
    );
    assert.strictEqual(
      editor.selection.active.line, 3,
      `Attendu L3, obtenu L${editor.selection.active.line}`,
    );
  });

  // ─── NH-2 — Forward after back restores the destination ──────────────────

  test('NH-2 — forward après back restaure la destination', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await waitForEditor('ApiService.kt', 3);

    await vscode.commands.executeCommand('kotlinJump.navigateForward');
    const editor = await waitForEditor('ApiServiceImpl.kt', 4);

    assert.ok(
      editor.document.fileName.endsWith('ApiServiceImpl.kt'),
      `Attendu ApiServiceImpl.kt, obtenu ${path.basename(editor.document.fileName)}`,
    );
    assert.strictEqual(
      editor.selection.active.line, 4,
      `Attendu L4, obtenu L${editor.selection.active.line}`,
    );
  });

  // ─── NH-3 — Back navigates through 3 files in order ─────────────────────

  test('NH-3 — back enchaîné sur 3 fichiers', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);
    await placeAt(demoUri('data/PokemonRepository.kt'), 15);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await waitForEditor('ApiServiceImpl.kt', 4);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    const editor = await waitForEditor('ApiService.kt', 3);

    assert.ok(
      editor.document.fileName.endsWith('ApiService.kt'),
      `Attendu ApiService.kt, obtenu ${path.basename(editor.document.fileName)}`,
    );
  });

  // ─── NH-4 — Back at the leftmost boundary is a no-op ────────────────────

  test('NH-4 — back à la borne gauche ne déplace pas le curseur', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);

    // exhaust history
    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await new Promise(r => setTimeout(r, 600));
    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await new Promise(r => setTimeout(r, 600));

    const active = vscode.window.activeTextEditor;
    assert.ok(active, 'Un éditeur actif doit exister');
    assert.ok(
      active.document.fileName.endsWith('ApiService.kt'),
      `Attendu ApiService.kt, obtenu ${path.basename(active.document.fileName)}`,
    );
  });

  // ─── NH-5 — Forward at the rightmost boundary is a no-op ─────────────────

  test('NH-5 — forward à la borne droite ne déclenche pas d\'erreur', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);

    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('kotlinJump.navigateForward');
      await new Promise(r => setTimeout(r, 600));
    });
  });

  // ─── NH-6 — New navigation after back truncates forward history ───────────

  test('NH-6 — naviguer vers D après back×2 efface l\'historique forward', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);
    await placeAt(demoUri('data/UserRepository.kt'), 8);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await waitForEditor('ApiServiceImpl.kt', 4);
    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await waitForEditor('ApiService.kt', 3);

    // Navigate to a new file — truncates ApiServiceImpl + UserRepository
    await placeAt(demoUri('data/PokeApiService.kt'), 3);

    await vscode.commands.executeCommand('kotlinJump.navigateForward');
    await new Promise(r => setTimeout(r, 600));

    const active = vscode.window.activeTextEditor;
    assert.ok(
      active?.document.fileName.endsWith('PokeApiService.kt'),
      `Forward devrait être un no-op — attendu PokeApiService.kt, obtenu ` +
      `${active ? path.basename(active.document.fileName) : 'none'}`,
    );
  });

  // ─── NH-7 — Column (character) position is restored ─────────────────────

  test('NH-7 — la colonne du curseur est restaurée par back', async () => {
    const COLUMN = 18;
    await placeAt(demoUri('data/ApiService.kt'), 3, COLUMN);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4, 20);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    const editor = await waitForEditor('ApiService.kt', 3);

    assert.strictEqual(
      editor.selection.active.character, COLUMN,
      `Attendu colonne ${COLUMN}, obtenu ${editor.selection.active.character}`,
    );
  });

  // ─── NH-8 — Works across different packages ──────────────────────────────

  test('NH-8 — navigation back/forward entre packages différents', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('demo/AbstractClassDemo.kt'), 14);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    const editor = await waitForEditor('ApiService.kt', 3);

    assert.ok(
      editor.document.fileName.includes('ApiService.kt'),
      `Attendu ApiService.kt, obtenu ${path.basename(editor.document.fileName)}`,
    );
  });

  // ─── NH-9 — Rapid back calls don't corrupt history ───────────────────────

  test('NH-9 — appels back rapides successifs sans await intermédiaire', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);
    await placeAt(demoUri('data/UserRepository.kt'), 8);

    // Fire two backs without awaiting between them — no crash, no corruption
    const p1 = vscode.commands.executeCommand('kotlinJump.navigateBack');
    const p2 = vscode.commands.executeCommand('kotlinJump.navigateBack');
    await Promise.all([p1, p2]);
    await new Promise(r => setTimeout(r, 800));

    // Should be somewhere in the history, not crashed
    const active = vscode.window.activeTextEditor;
    assert.ok(active, 'Un éditeur doit rester actif après backs rapides');
  });

  // ─── NH-10 — back then forward then back again (3-step round-trip) ────────

  test('NH-10 — round-trip back/forward/back restaure la bonne position', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 7);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await waitForEditor('ApiService.kt', 3);

    await vscode.commands.executeCommand('kotlinJump.navigateForward');
    await waitForEditor('ApiServiceImpl.kt', 7);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    const editor = await waitForEditor('ApiService.kt', 3);

    assert.strictEqual(editor.selection.active.line, 3,
      `Round-trip: attendu L3, obtenu L${editor.selection.active.line}`);
  });

  // ─── NH-11 — clearHistory resets state so back is a no-op ────────────────

  test('NH-11 — clearHistory remet back à l\'état initial', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);

    await vscode.commands.executeCommand('kotlinJump.clearNavigationHistory');
    await new Promise(r => setTimeout(r, 300));

    // Back should now be a no-op (empty history)
    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await new Promise(r => setTimeout(r, 600));

    const active = vscode.window.activeTextEditor;
    assert.ok(
      active?.document.fileName.endsWith('ApiServiceImpl.kt'),
      `Attendu ApiServiceImpl.kt (pas bougé), obtenu ${active ? path.basename(active.document.fileName) : 'none'}`,
    );
  });

  // ─── NH-12 — Deep history: 5 files, back all the way ─────────────────────

  test('NH-12 — historique profond : 5 fichiers, back jusqu\'au début', async () => {
    const files = [
      'data/ApiService.kt',
      'data/ApiServiceImpl.kt',
      'data/UserRepository.kt',
      'data/PokemonRepository.kt',
      'data/PokeApiService.kt',
    ];
    const lines = [3, 4, 8, 15, 3];

    for (let i = 0; i < files.length; i++) {
      await placeAt(demoUri(files[i]), lines[i]);
    }

    // Back through all 4 intermediate files
    for (let i = files.length - 2; i >= 0; i--) {
      await vscode.commands.executeCommand('kotlinJump.navigateBack');
      await waitForEditor(path.basename(files[i]), lines[i]);
    }

    const active = vscode.window.activeTextEditor;
    assert.ok(
      active?.document.fileName.endsWith('ApiService.kt'),
      `Attendu ApiService.kt au bout, obtenu ${active ? path.basename(active.document.fileName) : 'none'}`,
    );
  });

  // ─── NH-13 — Same file, same line twice: no duplicate in history ──────────

  test('NH-13 — ouvrir le même fichier+ligne deux fois ne duplique pas l\'historique', async () => {
    await placeAt(demoUri('data/ApiService.kt'), 3);
    // Re-open the exact same file at the exact same line
    await placeAt(demoUri('data/ApiService.kt'), 3);
    await placeAt(demoUri('data/ApiServiceImpl.kt'), 4);

    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    const editor = await waitForEditor('ApiService.kt', 3);

    // Should land in ApiService, not loop back to it twice
    assert.ok(editor.document.fileName.endsWith('ApiService.kt'),
      `Attendu ApiService.kt, obtenu ${path.basename(editor.document.fileName)}`);

    // One more back should be a no-op (not visit ApiService twice)
    await vscode.commands.executeCommand('kotlinJump.navigateBack');
    await new Promise(r => setTimeout(r, 600));
    const active = vscode.window.activeTextEditor;
    assert.ok(active?.document.fileName.endsWith('ApiService.kt'),
      `back supplémentaire ne devrait pas quitter ApiService.kt`);
  });
});
