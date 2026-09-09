import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UnusedSymbolProvider } from '../../src/providers/UnusedSymbolProvider';
import { findUnusedSymbols } from '../../src/providers/unusedSymbols';
import { workspace } from './__mocks__/vscode';

// Audit 48 : suite de l'audit 45. Le quick fix résout la déclaration sous le
// curseur sur le texte courant, puis retrouve SON finding par
// `findings.find(f => f.name === here.name)` : le premier du nom. Depuis que
// la 1.42.63 signale deux homonymes déclarés dans un même fichier, poser le
// curseur sur la seconde surcharge agissait sur le finding de la première.

const PATH = '/w/app/src/main/kotlin/Charge.kt';
const CODE = [
  'package p',
  '',
  'fun charger(id: Int) {}',
  '',
  'fun charger(nom: String) {}',
  '',
  'fun garder() = 1',
  '',
].join('\n');

function doc(path: string, code: string): any {
  const L = code.split('\n');
  return {
    uri: { fsPath: path, path, toString: () => `file://${path}`, scheme: 'file' },
    languageId: 'kotlin', version: 1, isDirty: false, lineCount: L.length,
    getText: (r?: any) => (r ? L[r.start.line].slice(r.start.character, r.end.character) : code),
    lineAt: (n: any) => ({ text: L[typeof n === 'number' ? n : n.line] ?? '' }),
    positionAt: (o: number) => {
      let n = 0;
      for (let i = 0; i < L.length; i++) {
        if (n + L[i].length >= o) return { line: i, character: o - n };
        n += L[i].length + 1;
      }
      return { line: L.length - 1, character: 0 };
    },
  };
}

const ligneDe = (aiguille: string) => CODE.split('\n').findIndex(l => l.includes(aiguille));

describe('Quick fix sur la seconde de deux surcharges mortes', () => {
  let provider: UnusedSymbolProvider;
  const origRead = workspace.fs.readFile;

  beforeEach(() => {
    provider = new UnusedSymbolProvider();
    const trouvailles = findUnusedSymbols({
      sources: [
        { path: PATH, text: CODE },
        { path: '/w/app/src/main/kotlin/Use.kt', text: 'package p\n\nfun go() = garder()\n' },
      ],
      testSourceSets: [],
    }).filter(f => f.path === PATH);
    // Le correctif de la 1.42.63 rend ce cas possible : un finding par surcharge.
    expect(trouvailles.map(f => f.line)).toEqual([2, 4]);
    provider.setFindings(trouvailles);
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
  });

  afterEach(() => {
    workspace.fs.readFile = origRead;
    provider.dispose();
  });

  const lignesEditees = async (ligne: number): Promise<number[]> => {
    const range = { start: { line: ligne, character: 0 }, end: { line: ligne, character: 0 } } as any;
    const actions = await provider.provideCodeActions(doc(PATH, CODE), range);
    const suppression = actions.find(a => a.title.startsWith('Delete'));
    expect(suppression, `aucune action Delete sur la ligne ${ligne}`).toBeDefined();
    const edit: any = suppression!.edit;
    const entrees: any[] = edit._entries ?? [];
    return entrees.map(e => e.range.start.line);
  };

  it('agit sur la ligne pointée, pour chacune des deux surcharges', async () => {
    expect(await lignesEditees(ligneDe('fun charger(id: Int)'))).toContain(2);
    // Avant : le finding de la ligne 2 était retenu, donc la suppression
    // proposée sur la ligne 4 effaçait la déclaration de la ligne 2.
    expect(await lignesEditees(ligneDe('fun charger(nom: String)'))).toContain(4);
  });

  it('ne touche jamais la sœur', async () => {
    expect(await lignesEditees(ligneDe('fun charger(nom: String)'))).not.toContain(2);
    expect(await lignesEditees(ligneDe('fun charger(id: Int)'))).not.toContain(4);
  });
});
