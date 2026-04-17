/**
 * Tests E2E pour les fonctionnalités de l'extension Kotlin Jump :
 * HoverProvider, ReferenceProvider, DocumentSymbolProvider,
 * WorkspaceSymbolProvider, DocumentColorProvider.
 *
 * [BUG] = teste un comportement incorrect connu, corrigé dans cette session.
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

function findLine(doc: vscode.TextDocument, text: string): number {
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(text)) return i;
  }
  throw new Error(`"${text}" introuvable dans ${doc.uri.fsPath}`);
}

function findLineFrom(doc: vscode.TextDocument, text: string, fromLine: number): number {
  for (let i = fromLine; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(text)) return i;
  }
  throw new Error(`"${text}" introuvable après la ligne ${fromLine}`);
}

function colOf(doc: vscode.TextDocument, line: number, name: string): number {
  const idx = doc.lineAt(line).text.indexOf(name);
  assert.ok(idx >= 0, `"${name}" introuvable à la ligne ${line}`);
  return idx;
}

function hoverText(hovers: vscode.Hover[]): string {
  return hovers.flatMap(h => h.contents)
    .map(c => typeof c === 'string' ? c : (c as vscode.MarkdownString).value)
    .join('\n');
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): string[] {
  const names: string[] = [];
  for (const s of symbols) {
    names.push(s.name);
    if (s.children?.length) names.push(...flattenSymbols(s.children));
  }
  return names;
}

suite('E2E — Features (real VS Code)', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    await vscode.extensions.getExtension('elumine.kotlin-jump')?.activate();
    await new Promise(r => setTimeout(r, 3000));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // ─── HOV — HoverProvider ────────────────────────────────────────────────────

  suite('HOV — HoverProvider (vscode.executeHoverProvider)', () => {
    test('HOV-1 : hover sur "ApiService" → hover non vide contenant le nom', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const line = findLine(doc, 'interface ApiService');
      const col  = colOf(doc, line, 'ApiService') + 2;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, new vscode.Position(line, col));
      assert.ok(hovers && hovers.length > 0, 'Pas de hover sur ApiService');
      const text = hoverText(hovers);
      assert.ok(text.includes('ApiService'), `Hover ne mentionne pas "ApiService": ${text.slice(0, 200)}`);
    });

    test('HOV-2 : hover sur "fetchUser" dans déclaration → hover non vide', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const line = findLine(doc, 'fun fetchUser');
      const col  = colOf(doc, line, 'fetchUser') + 2;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, new vscode.Position(line, col));
      assert.ok(hovers && hovers.length > 0, 'Pas de hover sur fetchUser');
      const text = hoverText(hovers);
      assert.ok(text.includes('fetchUser'), `Hover ne mentionne pas "fetchUser": ${text.slice(0, 200)}`);
    });

    test('HOV-3 : hover sur position vide (début de fichier) → pas de crash', async () => {
      const uri = demoUri('data/ApiService.kt');
      await openDoc(uri);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, new vscode.Position(0, 0));
      assert.ok(Array.isArray(hovers) || hovers === null, 'Doit retourner tableau ou null');
    });

    test('[BUG fixé] HOV-4 : hover sur "execute" dans PhysicalMove → non-null (multi-overrides même fichier)', async () => {
      // Avant fix : AbstractClassDemo.kt a abstract execute + 2 overrides dans le même fichier
      // → inFile.length >= 3 → retournait null
      // Après fix : tiebreak par position.line → retourne l'entry à la ligne exacte
      const uri = demoUri('demo/AbstractClassDemo.kt');
      const doc = await openDoc(uri);
      const classLine    = findLine(doc, 'class PhysicalMove');
      const overrideLine = findLineFrom(doc, 'override fun execute', classLine);
      const col = colOf(doc, overrideLine, 'execute') + 2;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, new vscode.Position(overrideLine, col));
      assert.ok(hovers && hovers.length > 0,
        `[BUG] HoverProvider doit retourner un hover pour l'override en colonne ${col} ligne ${overrideLine}`);
    });

    test('[BUG fixé] HOV-5 : hover sur "accept" dans PewterGym → non-null (4 overrides dans WelcomeDemo.kt)', async () => {
      // 4 méthodes "accept" dans WelcomeDemo.kt (interface + 3 impls)
      // Avant fix : inFile.length === 4 → retournait null
      // Après fix : tiebreak par ligne exact → retourne l'entry correspondante
      const uri = demoUri('demo/WelcomeDemo.kt');
      const doc = await openDoc(uri);
      const classLine    = findLine(doc, 'class PewterGym');
      const overrideLine = findLineFrom(doc, 'override fun accept', classLine);
      const col = colOf(doc, overrideLine, 'accept') + 2;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', uri, new vscode.Position(overrideLine, col));
      assert.ok(hovers && hovers.length > 0,
        `[BUG] HoverProvider doit retourner un hover pour PewterGym.accept (ligne ${overrideLine})`);
    });
  });

  // ─── REF — ReferenceProvider ────────────────────────────────────────────────

  suite('REF — ReferenceProvider (vscode.executeReferenceProvider)', () => {
    test('REF-1 : références à "ApiService" → ≥ 1', async () => {
      const uri = demoUri('data/ApiService.kt');
      const doc = await openDoc(uri);
      const line = findLine(doc, 'interface ApiService');
      const col  = colOf(doc, line, 'ApiService') + 2;
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', uri, new vscode.Position(line, col));
      assert.ok(refs && refs.length >= 1,
        `Doit trouver ≥ 1 référence pour "ApiService", trouvé: ${refs?.length}`);
    });

    test('REF-2 : références à "PokemonRepository" → ≥ 6 (nombreux impls + usages)', async () => {
      const uri = demoUri('data/PokemonRepository.kt');
      const doc = await openDoc(uri);
      const line = findLine(doc, 'interface PokemonRepository');
      const col  = colOf(doc, line, 'PokemonRepository') + 2;
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', uri, new vscode.Position(line, col));
      assert.ok(refs && refs.length >= 6,
        `Doit trouver ≥ 6 références pour "PokemonRepository", trouvé: ${refs?.length}`);
    });

    test('REF-3 : position sans symbole → résultat sans crash', async () => {
      const uri = demoUri('data/ApiService.kt');
      await openDoc(uri);
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider', uri, new vscode.Position(0, 0));
      assert.ok(refs !== undefined, 'Ne doit pas lancer d\'exception');
    });
  });

  // ─── DSP — DocumentSymbolProvider ──────────────────────────────────────────

  suite('DSP — DocumentSymbolProvider (vscode.executeDocumentSymbolProvider)', () => {
    test('DSP-1 : ApiService.kt → outline contient "ApiService" et "fetchUser"', async () => {
      const uri = demoUri('data/ApiService.kt');
      await openDoc(uri);
      const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri);
      assert.ok(syms && syms.length > 0, 'Outline vide pour ApiService.kt');
      const all = flattenSymbols(syms);
      assert.ok(all.includes('ApiService'), `"ApiService" absent de l'outline: ${all}`);
      assert.ok(all.includes('fetchUser'),  `"fetchUser" absent de l'outline: ${all}`);
    });

    test('DSP-2 : WelcomeDemo.kt → outline contient les 4 classes (interface + 3 impls)', async () => {
      const uri = demoUri('demo/WelcomeDemo.kt');
      await openDoc(uri);
      const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri);
      assert.ok(syms && syms.length > 0, 'Outline vide pour WelcomeDemo.kt');
      const all = flattenSymbols(syms);
      for (const name of ['GymChallenge', 'PewterGym', 'CeruleanGym', 'VermilionGym']) {
        assert.ok(all.includes(name), `"${name}" absent de l'outline: ${all}`);
      }
    });

    test('DSP-3 : SealedWhenDemo.kt → sealed class "LoadState" avec ses sous-types', async () => {
      const uri = demoUri('demo/SealedWhenDemo.kt');
      await openDoc(uri);
      const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri);
      assert.ok(syms && syms.length > 0, 'Outline vide pour SealedWhenDemo.kt');
      const all = flattenSymbols(syms);
      assert.ok(all.includes('LoadState'), `"LoadState" absent de l'outline: ${all}`);
      const hasSubtype = ['Loading', 'Success', 'Error'].some(n => all.includes(n));
      assert.ok(hasSubtype,
        `Aucun sous-type de LoadState (Loading/Success/Error) dans l'outline: ${all}`);
    });
  });

  // ─── WSP — WorkspaceSymbolProvider ─────────────────────────────────────────

  suite('WSP — WorkspaceSymbolProvider (vscode.executeWorkspaceSymbolProvider)', () => {
    test('WSP-1 : query "ApiService" → trouve l\'interface', async () => {
      const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider', 'ApiService');
      assert.ok(syms && syms.length > 0, 'Aucun résultat pour "ApiService"');
      assert.ok(syms.some(s => s.name === 'ApiService'),
        `"ApiService" introuvable dans: ${syms.map(s => s.name)}`);
    });

    test('WSP-2 : query "GymChallenge" → au moins 1 résultat', async () => {
      const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider', 'GymChallenge');
      assert.ok(syms && syms.length >= 1,
        `Doit trouver "GymChallenge", trouvé: ${syms?.length}`);
    });

    test('WSP-3 : query "Api" → résultats non vides (index peuplé)', async () => {
      // La plupart des WorkspaceSymbolProviders retournent [] pour query vide (comportement normal).
      // On teste avec un préfixe connu pour vérifier que l'index est peuplé.
      const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider', 'Api');
      assert.ok(syms && syms.length > 0, 'Index vide — aucun résultat pour "Api"');
    });

    test('WSP-4 : query symbole inexistant → [] sans crash', async () => {
      const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider', 'ZzzSymboleInexistantXyz999');
      assert.ok(Array.isArray(syms), 'Doit retourner un tableau');
      assert.strictEqual(syms.length, 0,
        `Doit retourner 0 résultats pour symbole inexistant, trouvé: ${syms.length}`);
    });
  });

  // ─── COL — DocumentColorProvider ───────────────────────────────────────────

  suite('COL — DocumentColorProvider (vscode.executeDocumentColorProvider)', () => {
    test('COL-1 : ThemeColors.kt → ≥ 5 couleurs hex détectées', async () => {
      const uri = demoUri('ui/ThemeColors.kt');
      await openDoc(uri);
      const colors = await vscode.commands.executeCommand<vscode.ColorInformation[]>(
        'vscode.executeDocumentColorProvider', uri);
      assert.ok(colors && colors.length >= 5,
        `Doit trouver ≥ 5 couleurs dans ThemeColors.kt, trouvé: ${colors?.length}`);
      for (const c of (colors ?? []).slice(0, 5)) {
        assert.ok(c.color.red   >= 0 && c.color.red   <= 1, 'Canal rouge hors plage [0,1]');
        assert.ok(c.color.green >= 0 && c.color.green <= 1, 'Canal vert hors plage [0,1]');
        assert.ok(c.color.blue  >= 0 && c.color.blue  <= 1, 'Canal bleu hors plage [0,1]');
        assert.ok(c.color.alpha >= 0 && c.color.alpha <= 1, 'Canal alpha hors plage [0,1]');
      }
    });

    test('COL-2 : ApiService.kt (sans couleur) → [] sans crash', async () => {
      const uri = demoUri('data/ApiService.kt');
      await openDoc(uri);
      const colors = await vscode.commands.executeCommand<vscode.ColorInformation[]>(
        'vscode.executeDocumentColorProvider', uri);
      assert.ok(colors !== undefined, 'Ne doit pas lancer d\'exception');
      assert.strictEqual(colors?.length ?? 0, 0,
        `Pas de couleur dans ApiService.kt, trouvé: ${colors?.length}`);
    });

    test('COL-3 : ThemeColors.kt → 0xFF7F52FF correctement parsé en ARGB (canaux vérifiés)', async () => {
      // 0xFF7F52FF : A=0xFF=1.0, R=0x7F≈0.498, G=0x52≈0.322, B=0xFF=1.0
      const uri = demoUri('ui/ThemeColors.kt');
      await openDoc(uri);
      const colors = await vscode.commands.executeCommand<vscode.ColorInformation[]>(
        'vscode.executeDocumentColorProvider', uri);
      assert.ok(colors && colors.length > 0, 'Aucune couleur dans ThemeColors.kt');
      const c = colors[0].color;
      assert.ok(Math.abs(c.alpha - 1.0       ) < 0.01, `Alpha attendu ≈1.0, reçu: ${c.alpha}`);
      assert.ok(Math.abs(c.red   - 127 / 255 ) < 0.01, `Red attendu ≈0.498, reçu: ${c.red}`);
      assert.ok(Math.abs(c.green -  82 / 255 ) < 0.01, `Green attendu ≈0.322, reçu: ${c.green}`);
      assert.ok(Math.abs(c.blue  - 1.0       ) < 0.01, `Blue attendu ≈1.0, reçu: ${c.blue}`);
    });

    test('COL-4 : Sprint2VisualDemo.kt — provider ne crashe pas sur fichier sans hex inline', async () => {
      // Sprint2VisualDemo.kt utilise R.color.* mais pas de hex literals dans le code Kotlin
      const uri = demoUri('sprint2/Sprint2VisualDemo.kt');
      await openDoc(uri);
      const colors = await vscode.commands.executeCommand<vscode.ColorInformation[]>(
        'vscode.executeDocumentColorProvider', uri);
      assert.ok(Array.isArray(colors), 'Doit retourner un tableau');
    });
  });
});
