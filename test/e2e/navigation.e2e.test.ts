import * as vscode from 'vscode';
import * as path from 'path';
import * as assert from 'assert';

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

function colOf(doc: vscode.TextDocument, line: number, name: string): number {
  const idx = doc.lineAt(line).text.indexOf(name);
  assert.ok(idx >= 0, `"${name}" introuvable à la ligne ${line}`);
  return idx;
}

async function execDef(uri: vscode.Uri, pos: vscode.Position): Promise<vscode.Location[]> {
  return (await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeDefinitionProvider', uri, pos,
  )) ?? [];
}

async function execImpl(uri: vscode.Uri, pos: vscode.Position): Promise<vscode.Location[]> {
  return (await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeImplementationProvider', uri, pos,
  )) ?? [];
}

suite('E2E — Navigation (real VS Code)', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
    // Laisser l'indexeur terminer
    await new Promise(r => setTimeout(r, 3000));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── Suite 1 — executeDefinitionProvider (F12) ───────────────────────────

  suite('Suite 1 — executeDefinitionProvider (F12)', function () {
    test('DEF-1 — fetchUser déclaration → ≥1 location vers ApiServiceImpl', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(3, colOf(doc, 3, 'fetchUser')));

      assert.ok(defs.length >= 1, `Attendu ≥1 locations, obtenu ${defs.length}`);
      assert.ok(
        defs.some(d => d.uri.fsPath.includes('ApiServiceImpl')),
        `Attendu une location vers ApiServiceImpl. Got: ${defs.map(d => path.basename(d.uri.fsPath)).join(', ')}`,
      );
    });

    test('DEF-2 — override fun fetchUser → navigue vers la base ApiService L3', async () => {
      const uri = demoUri('data/ApiServiceImpl.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(4, colOf(doc, 4, 'fetchUser')));

      assert.strictEqual(defs.length, 1, `Attendu 1 location, obtenu ${defs.length}`);
      assert.ok(defs[0].uri.fsPath.includes('ApiService.kt'), `Attendu ApiService.kt, obtenu ${defs[0].uri.fsPath}`);
      assert.strictEqual(defs[0].range.start.line, 3, `Attendu L3 (base), obtenu L${defs[0].range.start.line}`);
    });

    test('DEF-3 — override fun execute → navigue vers MoveStrategy.execute L14', async () => {
      const uri = demoUri('demo/AbstractClassDemo.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(20, colOf(doc, 20, 'execute')));

      assert.strictEqual(defs.length, 1, `Attendu 1 location, obtenu ${defs.length}`);
      assert.ok(defs[0].uri.fsPath.includes('AbstractClassDemo'), `Attendu AbstractClassDemo, obtenu ${path.basename(defs[0].uri.fsPath)}`);
      assert.strictEqual(defs[0].range.start.line, 14, `Attendu L14 (base), obtenu L${defs[0].range.start.line}`);
    });

    // BUG-1 : DefinitionProvider.ts L69+L108 ne couvre que 'fun'|'composable' — 'val'/'var' exclus.
    // Sans fix : retourne L155 (lui-même). Après fix : retourne L78 (déclaration de l'interface).
    test('DEF-4 — override val interfaceProp → navigue vers la base RegularInterface L78 [BUG-1]', async () => {
      const uri = demoUri('SyntaxVerification.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(155, colOf(doc, 155, 'interfaceProp')));

      assert.ok(defs.length >= 1, `Attendu ≥1 location, obtenu ${defs.length}`);
      const baseDef = defs.find(d =>
        d.uri.fsPath.includes('SyntaxVerification') && d.range.start.line === 78,
      );
      assert.ok(
        baseDef,
        `Attendu navigation vers L78 (base de RegularInterface). Lignes obtenues: ${defs.map(d => d.range.start.line).join(', ')}`,
      );
    });

    test('DEF-5 — interface GymChallenge → exactement 3 implementations', async () => {
      const uri = demoUri('demo/WelcomeDemo.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(6, colOf(doc, 6, 'GymChallenge')));

      assert.strictEqual(
        defs.length, 3,
        `Attendu 3 locations (PewterGym, CeruleanGym, VermilionGym), obtenu ${defs.length}: ${defs.map(d => path.basename(d.uri.fsPath) + ':' + d.range.start.line).join(', ')}`,
      );
    });
  });

  // ─── Suite 2 — executeImplementationProvider (Cmd+F12) ───────────────────

  suite('Suite 2 — executeImplementationProvider (Cmd+F12)', function () {
    test('IMPL-1 — ApiService → exactement 1 implementation (ApiServiceImpl)', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(2, colOf(doc, 2, 'ApiService')));

      assert.strictEqual(impls.length, 1, `Attendu 1 impl, obtenu ${impls.length}: ${impls.map(i => path.basename(i.uri.fsPath)).join(', ')}`);
      assert.ok(impls[0].uri.fsPath.includes('ApiServiceImpl'), `Attendu ApiServiceImpl, obtenu ${path.basename(impls[0].uri.fsPath)}`);
      assert.strictEqual(impls[0].range.start.line, 2, `Attendu L2, obtenu L${impls[0].range.start.line}`);
    });

    test('IMPL-2 — fetchUser méthode (ApiService) → exactement 1 implementation (L4)', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(3, colOf(doc, 3, 'fetchUser')));

      assert.strictEqual(impls.length, 1, `Attendu 1 impl, obtenu ${impls.length}`);
      assert.ok(impls[0].uri.fsPath.includes('ApiServiceImpl'), `Attendu ApiServiceImpl, obtenu ${path.basename(impls[0].uri.fsPath)}`);
      assert.strictEqual(impls[0].range.start.line, 4, `Attendu L4, obtenu L${impls[0].range.start.line}`);
    });

    // Régression : $anon$N ne doit pas gonfler le compte
    test('IMPL-3 — PokemonRepository → exactement 6 implementations (régression $anon)', async () => {
      const uri = demoUri('data/PokemonRepository.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(15, colOf(doc, 15, 'PokemonRepository')));

      assert.strictEqual(
        impls.length, 6,
        `Attendu 6 impls, obtenu ${impls.length}: ${impls.map(i => path.basename(i.uri.fsPath)).join(', ')}`,
      );
    });

    test('IMPL-4 — catch méthode (PokemonRepository) → exactement 6 implementations', async () => {
      const uri = demoUri('data/PokemonRepository.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(24, colOf(doc, 24, 'catch')));

      assert.strictEqual(
        impls.length, 6,
        `Attendu 6 impls, obtenu ${impls.length}: ${impls.map(i => path.basename(i.uri.fsPath) + ':L' + i.range.start.line).join(', ')}`,
      );
    });

    test('IMPL-5 — execute abstract (MoveStrategy) → exactement 2 implementations', async () => {
      const uri = demoUri('demo/AbstractClassDemo.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(14, colOf(doc, 14, 'execute')));

      assert.strictEqual(
        impls.length, 2,
        `Attendu 2 impls (PhysicalMove + SpecialMove), obtenu ${impls.length}: ${impls.map(i => path.basename(i.uri.fsPath) + ':L' + i.range.start.line).join(', ')}`,
      );
    });

    // UserRepository a 3 impls : UserRepositoryImpl (main) + 2 fakes dans les tests
    test('IMPL-6 — UserRepository → ≥1 implementation, inclut UserRepositoryImpl L14', async () => {
      const uri = demoUri('data/UserRepository.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(8, colOf(doc, 8, 'UserRepository')));

      assert.ok(impls.length >= 1, `Attendu ≥1 impls, obtenu ${impls.length}`);
      const mainImpl = impls.find(i =>
        i.uri.fsPath.includes('UserRepository') && i.range.start.line === 14,
      );
      assert.ok(mainImpl, `Attendu UserRepositoryImpl L14 parmi les résultats. Got: ${impls.map(i => path.basename(i.uri.fsPath) + ':L' + i.range.start.line).join(', ')}`);
    });

    // Régression inflation : LoadState a 3 sous-types, pas plus
    test('IMPL-7 — LoadState sealed → exactement 3 sous-types (régression inflation)', async () => {
      const uri = demoUri('demo/SealedWhenDemo.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(18, colOf(doc, 18, 'LoadState')));

      assert.strictEqual(
        impls.length, 3,
        `Attendu 3 sous-types (Loading, Success, Error), obtenu ${impls.length}: ${impls.map(i => path.basename(i.uri.fsPath) + ':L' + i.range.start.line).join(', ')}`,
      );
    });
  });

  // ─── Suite 3 — kotlin-jump.goToClassImpl (⬇ classe) ─────────────────────

  suite('Suite 3 — kotlin-jump.goToClassImpl (⬇ classe)', function () {
    async function goToClass(name: string, pkg: string, expectedFile: string, expectedLine: number): Promise<void> {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('kotlin-jump.goToClassImpl', name, pkg);
      await new Promise(r => setTimeout(r, 1500));
      const active = vscode.window.activeTextEditor;
      assert.ok(active, `Aucun éditeur actif après goToClassImpl('${name}')`);
      assert.ok(
        active.document.fileName.includes(expectedFile),
        `Attendu ${expectedFile}, obtenu ${path.basename(active.document.fileName)}`,
      );
      assert.strictEqual(
        active.selection.active.line, expectedLine,
        `Attendu curseur L${expectedLine}, obtenu L${active.selection.active.line}`,
      );
    }

    test('CLS-1 — ApiService → ApiServiceImpl L2', async () => {
      await goToClass('ApiService', 'com.example.data', 'ApiServiceImpl', 2);
    });

    // UserRepository a 3 impls → QuickPick, pas de navigation directe — on vérifie no-throw
    test('CLS-2 — UserRepository (3 impls) → QuickPick sans throw', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      let caughtError: Error | undefined;
      vscode.commands.executeCommand('kotlin-jump.goToClassImpl', 'UserRepository', 'com.example.data')
        .catch((e: Error) => { caughtError = e; });
      await new Promise(r => setTimeout(r, 500));
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      await new Promise(r => setTimeout(r, 300));
      assert.ok(!caughtError, `goToClassImpl a lancé une erreur : ${caughtError?.message}`);
    });

    test('CLS-3 — PokeApiService → PokeApiService.kt L7 (même fichier)', async () => {
      await goToClass('PokeApiService', 'com.example.data', 'PokeApiService', 7);
    });
  });

  // ─── Suite 4 — kotlin-jump.goToMethodImpl (⬇ méthode) ───────────────────

  suite('Suite 4 — kotlin-jump.goToMethodImpl (⬇ méthode)', function () {
    async function goToMethod(
      sourceUri: vscode.Uri, line: number, name: string,
      expectedFile: string, expectedLine: number,
    ): Promise<void> {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      // Le 4e arg (_implUriStrings) est ignoré par le handler — on passe []
      await vscode.commands.executeCommand('kotlin-jump.goToMethodImpl', sourceUri, line, name, []);
      await new Promise(r => setTimeout(r, 1500));
      const active = vscode.window.activeTextEditor;
      assert.ok(active, `Aucun éditeur actif après goToMethodImpl('${name}')`);
      assert.ok(
        active.document.fileName.includes(expectedFile),
        `Attendu ${expectedFile}, obtenu ${path.basename(active.document.fileName)}`,
      );
      assert.strictEqual(
        active.selection.active.line, expectedLine,
        `Attendu curseur L${expectedLine}, obtenu L${active.selection.active.line}`,
      );
    }

    test('MTH-1 — fetchPokemon → PokeApiService.kt L9', async () => {
      await goToMethod(demoUri('data/PokeApiService.kt'), 3, 'fetchPokemon', 'PokeApiService', 9);
    });

    // fetchUser a 1 seule implementation (ApiServiceImpl L4) → navigation directe
    test('MTH-2 — fetchUser (ApiService) → ApiServiceImpl.kt L4', async () => {
      await goToMethod(demoUri('data/ApiService.kt'), 3, 'fetchUser', 'ApiServiceImpl', 4);
    });
  });

  // ─── Suite 5 — kotlin-jump.revealDefinitionAt (⬆ override) ──────────────

  suite('Suite 5 — kotlin-jump.revealDefinitionAt (⬆ override)', function () {
    async function revealAt(
      uri: vscode.Uri, line: number, name: string,
      expectedFile: string, expectedLine: number,
    ): Promise<void> {
      const doc = await openDoc(uri);
      const col = colOf(doc, line, name);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand(
        'kotlin-jump.revealDefinitionAt', uri, new vscode.Position(line, col),
      );
      await new Promise(r => setTimeout(r, 1500));
      const active = vscode.window.activeTextEditor;
      assert.ok(active, `Aucun éditeur actif après revealDefinitionAt`);
      assert.ok(
        active.document.fileName.includes(expectedFile),
        `Attendu ${expectedFile}, obtenu ${path.basename(active.document.fileName)}`,
      );
      assert.strictEqual(
        active.selection.active.line, expectedLine,
        `Attendu curseur L${expectedLine}, obtenu L${active.selection.active.line}`,
      );
    }

    test('REV-1 — fetchUser override (ApiServiceImpl L4) → ApiService L3', async () => {
      await revealAt(demoUri('data/ApiServiceImpl.kt'), 4, 'fetchUser', 'ApiService.kt', 3);
    });

    test('REV-2 — execute override (AbstractClassDemo L20) → MoveStrategy L14', async () => {
      await revealAt(demoUri('demo/AbstractClassDemo.kt'), 20, 'execute', 'AbstractClassDemo', 14);
    });

    test('REV-3 — accept override (WelcomeDemo L34) → GymChallenge.accept L7', async () => {
      await revealAt(demoUri('demo/WelcomeDemo.kt'), 34, 'accept', 'WelcomeDemo', 7);
    });

    // BUG-1 : sans fix, revealDefinitionAt retourne L155 (lui-même) car DefinitionProvider
    // ne gère pas override val/var. Après fix : navigue vers L78 (déclaration de l'interface).
    test('REV-4 — override val interfaceProp → base RegularInterface L78 [BUG-1]', async () => {
      await revealAt(demoUri('SyntaxVerification.kt'), 155, 'interfaceProp', 'SyntaxVerification', 78);
    });
  });

  // ─── Robustesse ──────────────────────────────────────────────────────────

  suite('Robustesse', function () {
    test('ROB-1 — executeDefinitionProvider sur package keyword → null ou []', async () => {
      const uri = demoUri('data/ApiService.kt');
      await openDoc(uri);
      const result = await vscode.commands.executeCommand<vscode.Location[] | null>(
        'vscode.executeDefinitionProvider', uri, new vscode.Position(0, 0),
      );
      // Pas de crash — résultat null ou vide accepté
      assert.ok(
        result == null || (Array.isArray(result) && result.length === 0),
        `Attendu null ou [], obtenu ${JSON.stringify(result)}`,
      );
    });

    test('ROB-2 — executeImplementationProvider sur classe concrète → []', async () => {
      const uri = demoUri('data/ApiServiceImpl.kt');
      const doc = await openDoc(uri);
      const impls = await execImpl(uri, new vscode.Position(2, colOf(doc, 2, 'ApiServiceImpl')));

      assert.strictEqual(impls.length, 0, `Classe concrète ne devrait pas avoir d'impls, obtenu ${impls.length}`);
    });

    test('ROB-3 — goToClassImpl sur interface inexistante → pas de throw', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await assert.doesNotReject(
        () => vscode.commands.executeCommand(
          'kotlin-jump.goToClassImpl', 'NonExistentInterface99', 'com.example.fake',
        ),
      );
    });

    test('ROB-4 — executeDefinitionProvider sur déclaration concrète → pas de navigation vers un fichier non lié', async () => {
      const uri = demoUri('data/ApiServiceImpl.kt');
      const doc = await openDoc(uri);
      const defs = await execDef(uri, new vscode.Position(2, colOf(doc, 2, 'ApiServiceImpl')));

      for (const d of defs) {
        assert.ok(
          d.uri.fsPath.includes('ApiService'),
          `Navigation fantôme vers ${path.basename(d.uri.fsPath)} — attendu ApiService*`,
        );
      }
    });
  });
});
