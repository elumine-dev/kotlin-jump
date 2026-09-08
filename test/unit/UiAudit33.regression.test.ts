import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { NavigationHistoryProvider } from '../../src/providers/NavigationHistoryProvider';
import { segmentMatchesPath, isTestPath } from '../../src/util/testPaths';

// Audit 33 : l'historique de navigation et le filtre de sources de test.

function makeEditor(uri: string, line: number, character = 0) {
  return {
    document: { uri: { toString: () => uri } },
    selection: { active: new vscode.Position(line, character) },
  } as any;
}

function selectionEvent(uri: string, line: number, kind: any, character = 0) {
  return {
    textEditor: makeEditor(uri, line, character),
    selections: [{ active: new vscode.Position(line, character) }],
    kind,
  } as any;
}

let editorListener: (e: any) => void;
let selectionListener: (e: any) => void;
const registeredCmds = new Map<string, () => Promise<void>>();

beforeEach(() => {
  registeredCmds.clear();
  (vscode.window as any).activeTextEditor = undefined;
  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((id: string, handler: any) => {
    registeredCmds.set(id, handler);
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
  vi.spyOn(vscode.window, 'onDidChangeActiveTextEditor').mockImplementation((cb: any) => {
    editorListener = cb;
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockImplementation((cb: any) => {
    selectionListener = cb;
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);
  vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({
    selection: undefined as any,
    revealRange: vi.fn(),
  } as any);
});

afterEach(() => vi.restoreAllMocks());

describe('Changement d\'onglet', () => {
  it('enregistre la position réelle du curseur, pas la ligne 0', () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50, 4);
    const p = new NavigationHistoryProvider();
    // Onglet B déjà ouvert, curseur en (120, 7). Aucun évènement de sélection
    // n'est émis : VS Code ne rejoue rien pour un onglet déjà visité.
    editorListener(makeEditor('file:///B.kt', 120, 7));
    const entries = p.recentLocations();
    const last = entries[entries.length - 1];
    // Avant : { line: 0, character: 0 }, et Back ramenait en haut du fichier.
    expect([last.line, last.character]).toEqual([120, 7]);
    p.dispose();
  });
});

describe('Back pressé juste après un saut', () => {
  it('ne détruit pas l\'entrée d\'origine', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50, 4);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 50, vscode.TextEditorSelectionChangeKind.Keyboard, 4));

    editorListener(makeEditor('file:///B.kt', 10, 0));
    const before = p.recentLocations().map(e => `${e.file}:${e.line}`);

    // Back dans la fenêtre de 500 ms.
    await registeredCmds.get('kotlinJump.navigateBack')!();
    // Évènement tardif pour B, du genre restauration de vue par VS Code.
    selectionListener(selectionEvent('file:///B.kt', 10, vscode.TextEditorSelectionChangeKind.Command, 0));

    const after = p.recentLocations().map(e => `${e.file}:${e.line}`);
    // Avant : l'entrée pointée par le curseur, celle de A, était réécrite avec
    // l'URI et la ligne de B. Le chemin du retour disparaissait.
    expect(after).toEqual(before);
    expect(after.some(e => e.startsWith('file:///A.kt'))).toBe(true);
    p.dispose();
  });
});

describe('Reconnaissance d\'un fichier de test', () => {
  const SETS = ['test/kotlin', 'test/java', 'androidTest/kotlin'];

  it('un chemin Windows est reconnu comme un chemin POSIX', () => {
    // Uri.fsPath rend des antislashs sous Windows. Le filtre ne voyait alors
    // aucun fichier de test, et sa décision s'inversait : depuis un fichier de
    // test, les résultats des autres fichiers de test étaient masqués.
    expect(isTestPath('c:\\proj\\app\\src\\test\\kotlin\\FooTest.kt', SETS)).toBe(true);
    expect(isTestPath('c:\\proj\\app\\src\\main\\kotlin\\Foo.kt', SETS)).toBe(false);
    expect(isTestPath('/proj/app/src/test/kotlin/FooTest.kt', SETS)).toBe(true);
    expect(segmentMatchesPath('c:\\proj\\src\\androidTest\\kotlin', 'androidTest/kotlin')).toBe(true);
  });

  it('le faux positif que la borne de segment corrige vaut aussi sous Windows', () => {
    // `test/kotlin-jump-demo` commence par les mêmes lettres sans être un
    // source set de test.
    expect(isTestPath('/repos/test/kotlin-jump-demo/src/main/kotlin/A.kt', SETS)).toBe(false);
    expect(isTestPath('c:\\repos\\test\\kotlin-jump-demo\\src\\main\\kotlin\\A.kt', SETS)).toBe(false);
  });
});

describe('Go to Definition dans un dépôt dont un dossier commence par test', () => {
  it('un répertoire test/kotlin-jump-demo n\'est pas un source set de test', async () => {
    const { KotlinDefinitionProvider } = await import('../../src/providers/DefinitionProvider');
    const { SymbolIndex } = await import('../../src/indexer/SymbolIndex');
    const { parse } = await import('../../src/indexer/KotlinParser');
    const { mockDocument, positionOf } = await import('./helpers');

    const DECL = 'file:///repos/test/kotlin-jump-demo/src/main/kotlin/Repo.kt';
    const USE = 'file:///repos/app/src/main/kotlin/Screen.kt';
    const declCode = 'package com.demo\n\nclass DemoRepo';
    const useCode = 'package com.app\n\nimport com.demo.DemoRepo\n\nval r = DemoRepo()';

    // Le réglage doit être réellement peuplé : la valeur par défaut du code
    // est une liste vide, avec laquelle aucun chemin n'est jamais un test.
    const origCfg = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, def: any) => (key === 'testSourceSets' ? ['test/kotlin', 'test/java'] : def),
    });

    const index = new SymbolIndex();
    index.add(parse(DECL, declCode));
    index.add(parse(USE, useCode));
    index.finalize();

    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument(USE, useCode);
    const pos = positionOf(useCode, 'DemoRepo()');
    const found = await provider.provideDefinition(doc, pos, {} as any);
    // Avant : la copie locale de isTestPath dans DefinitionProvider faisait un
    // includes() non borné, classait tout ce répertoire comme du test, et Go
    // to Definition depuis un fichier de production ne trouvait plus rien.
    expect(found).toBeTruthy();
    const loc: any = Array.isArray(found) ? found[0] : found;
    expect((loc.uri ?? loc.targetUri).toString()).toBe(DECL);
    (vscode.workspace as any).getConfiguration = origCfg;
  });
});
