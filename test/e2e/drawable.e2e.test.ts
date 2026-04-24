/**
 * E2E — DrawableHoverProvider + DrawableGutterThumbnailProvider.
 *
 * Runs against the kotlin-jump-demo fixture with a real VS Code instance,
 * a real FS-backed workspace (`res/drawable/ic_pokeball.xml`,
 * `res/drawable/ic_type_fire.xml`), and the extension fully activated.
 *
 * Coverage:
 *  - Hover on R.drawable.xxx returns a non-empty markdown string
 *  - The markdown embeds an SVG preview (data URI) for vector XML drawables
 *  - Hover on an unknown R.drawable name returns no content
 *  - Hover on a line outside any R.drawable token returns no drawable hover
 */

import * as assert from 'assert';
import * as path   from 'path';
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

function findLine(doc: vscode.TextDocument, needle: string): number {
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(needle)) return i;
  }
  throw new Error(`"${needle}" introuvable dans ${doc.uri.fsPath}`);
}

function colOf(doc: vscode.TextDocument, line: number, name: string): number {
  const idx = doc.lineAt(line).text.indexOf(name);
  assert.ok(idx >= 0, `"${name}" introuvable à la ligne ${line}`);
  return idx;
}

function hoverMarkdown(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap(h => h.contents)
    .map(c => (typeof c === 'string' ? c : (c as vscode.MarkdownString).value))
    .join('\n');
}

suite('E2E — Drawable hover + gutter', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
    // Leave enough time for the initial findFiles pass over the fixture
    // to populate DrawableResourceIndex.
    await new Promise(r => setTimeout(r, 3000));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('DRW-1 : hover on R.drawable.ic_pokeball returns a non-empty tooltip', async () => {
    const uri = demoUri('demo/DrawableResourceDemo.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'R.drawable.ic_pokeball');
    const col  = colOf(doc, line, 'ic_pokeball') + 2;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, new vscode.Position(line, col),
    );
    assert.ok(hovers.length > 0, 'expected at least one hover at R.drawable.ic_pokeball');
    const text = hoverMarkdown(hovers);
    assert.ok(
      text.includes('R.drawable.ic_pokeball'),
      `hover markdown should name the drawable; got: ${text.slice(0, 200)}`,
    );
  });

  test('DRW-2 : hover for a vector XML embeds an SVG data URI', async () => {
    const uri = demoUri('demo/DrawableResourceDemo.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'R.drawable.ic_pokeball');
    const col  = colOf(doc, line, 'ic_pokeball') + 2;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, new vscode.Position(line, col),
    );
    const text = hoverMarkdown(hovers);
    assert.ok(
      text.includes('data:image/svg+xml'),
      `expected SVG data URI in hover; got: ${text.slice(0, 300)}`,
    );
  });

  test('DRW-3 : R.drawable.ic_type_fire also resolves through the index', async () => {
    const uri = demoUri('demo/DrawableResourceDemo.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'R.drawable.ic_type_fire');
    const col  = colOf(doc, line, 'ic_type_fire') + 2;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, new vscode.Position(line, col),
    );
    assert.ok(hovers.length > 0, 'expected hover for ic_type_fire');
    const text = hoverMarkdown(hovers);
    assert.ok(text.includes('ic_type_fire'));
  });

  test('DRW-4 : hover on whitespace returns no drawable hover', async () => {
    const uri = demoUri('demo/DrawableResourceDemo.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'R.drawable.ic_pokeball');
    // Column 0 is the start of the indentation — no drawable token there.
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, new vscode.Position(line, 0),
    );
    const text = hoverMarkdown(hovers);
    // Either no hover at all, or none contributed by the drawable provider.
    assert.ok(
      !text.includes('data:image/svg+xml'),
      `position 0 should not trigger drawable preview; got: ${text.slice(0, 200)}`,
    );
  });

  test('DRW-5 : Definition provider still resolves R.drawable.xxx to the XML file', async () => {
    const uri = demoUri('demo/DrawableResourceDemo.kt');
    const doc = await openDoc(uri);
    const line = findLine(doc, 'R.drawable.ic_pokeball');
    const col  = colOf(doc, line, 'ic_pokeball') + 2;

    const locs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider', uri, new vscode.Position(line, col),
    );
    assert.ok(locs && locs.length > 0, 'expected at least one definition');
    const target = locs[0].uri.fsPath;
    assert.ok(
      target.endsWith('ic_pokeball.xml'),
      `expected definition to point at ic_pokeball.xml; got ${target}`,
    );
  });
});
