// Real @vscode/test-web smoke test: runs inside an actual browser Web
// Extension Host, unlike test/unit/BrowserBundle.test.ts (a fast but
// artificial node:vm sandbox). This is the ONLY test that calls a real
// activate() in a real browser engine with no __dirname/worker_threads,
// exactly the condition that caused the historical regressions in commits
// 6e81662 and 2466ce9, both only ever caught by a manual, un-committed run.
//
// Workspace opens under the `vscode-test-web:` scheme, backed by the local
// fixture directory read-only (per @vscode/test-web's README). Never use
// vscode.Uri.file()/path.join() here, only vscode.Uri.joinPath() against the
// actual workspace folder URI, exactly like the web-portability rules this
// whole test exists to protect.
import * as vscode from 'vscode';

function fail(message: string): never {
  throw new Error(message);
}

function workspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) fail('No workspace folder open. Fixture not passed to vscode-test-web?');
  return folders[0].uri;
}

function fixtureUri(filename: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot(), filename);
}

async function openDoc(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

function findLine(doc: vscode.TextDocument, needle: string): number {
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(needle)) return i;
  }
  fail(`"${needle}" not found in ${doc.uri.toString()}`);
}

function colOf(doc: vscode.TextDocument, line: number, name: string): number {
  const idx = doc.lineAt(line).text.indexOf(name);
  if (idx < 0) fail(`"${name}" not found on line ${line} of ${doc.uri.toString()}`);
  return idx;
}

suite('Web — activation & navigation de base (vrai VS Code for the Web)', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('elumine.kotlin-jump');
    if (!ext) fail('Extension introuvable dans le host web, problème de manifest/packaging.');
    // Must resolve without throwing. This is exactly where WorkerPool's
    // __dirname fallback (src/indexer/WorkerPool.ts) is exercised in a real
    // browser JS engine that genuinely has no __dirname.
    await ext.activate();
    await new Promise(r => setTimeout(r, 3000)); // let FileScanner index the fixture
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('WEB-ACT-1 — activate() ne lève pas et l\'extension est active', () => {
    if (vscode.extensions.getExtension('elumine.kotlin-jump')?.isActive !== true) {
      fail('Extension not active after activate()');
    }
  });

  test('WEB-DEF-1 — Go to Definition : EnglishGreeter.greet → Greeter.greet', async () => {
    const uri = fixtureUri('EnglishGreeter.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'override fun greet');
    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, new vscode.Position(line, colOf(doc, line, 'greet')),
    );
    if (!defs?.some(d => d.uri.path.endsWith('Greeter.kt'))) {
      fail(`Attendu une location vers Greeter.kt, obtenu: ${defs?.map(d => d.uri.path).join(', ')}`);
    }
  });

  test('WEB-REF-1 — Find Usages : Greeter a au moins 2 références', async () => {
    const uri = fixtureUri('Greeter.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'interface Greeter');
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider', uri, new vscode.Position(line, colOf(doc, line, 'Greeter')),
    );
    if (!refs || refs.length < 2) {
      fail(`Attendu au moins 2 références (impl + usage), obtenu ${refs?.length ?? 0}`);
    }
  });

  test('WEB-STDLIB-1 — Go to Definition sur println résout dans le stdlib bundlé (kotlin-stdlib-jar:)', async () => {
    const uri = fixtureUri('Main.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'println(g.greet())');
    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, new vscode.Position(line, colOf(doc, line, 'println')),
    );
    if (!defs?.some(d => d.uri.scheme === 'kotlin-stdlib-jar')) {
      fail(`Attendu une location kotlin-stdlib-jar:, obtenu: ${defs?.map(d => d.uri.toString()).join(', ')}`);
    }
  });
});
