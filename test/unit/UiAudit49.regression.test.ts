import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UnusedDtoFieldProvider } from '../../src/providers/UnusedDtoFieldProvider';
import { UnusedEnumEntryProvider } from '../../src/providers/UnusedEnumEntryProvider';
import { findUnusedDtoFields } from '../../src/providers/unusedDtoFields';
import { findUnusedEnumEntries } from '../../src/providers/unusedEnumEntries';
import { findingAt } from '../../src/util/findingAt';

// Audit 49 : les quick fixes de la famille code mort appariaient leur finding
// sur la seule LIGNE du curseur. Kotlin declare les champs d'une data class et
// les entrees d'un enum sur une meme ligne, donc l'ampoule ouverte sur le
// second agissait sur le premier et supprimait le mauvais token. LaPresse
// porte 34 data classes et 4 enums ecrits ainsi.

function doc(path: string, code: string): any {
  const L = code.split('\n');
  const offsets: number[] = [];
  let n = 0;
  for (const l of L) { offsets.push(n); n += l.length + 1; }
  return {
    uri: { fsPath: path, path, toString: () => `file://${path}`, scheme: 'file' },
    languageId: 'kotlin', version: 1, isDirty: false, lineCount: L.length,
    getText: (r?: any) => (r ? L[r.start.line].slice(r.start.character, r.end.character) : code),
    lineAt: (nn: any) => ({ text: L[typeof nn === 'number' ? nn : nn.line] ?? '' }),
    offsetAt: (p: any) => offsets[p.line] + p.character,
    positionAt: (o: number) => {
      for (let i = L.length - 1; i >= 0; i--) if (o >= offsets[i]) return { line: i, character: o - offsets[i] };
      return { line: 0, character: 0 };
    },
  };
}

const plagesDe = (action: any): Array<[number, number]> =>
  ((action.edit as any)?._entries ?? []).map((e: any) => [e.range.start.character, e.range.end.character]);

describe('Deux champs DTO morts sur la même ligne', () => {
  const PATH = '/w/app/src/main/kotlin/Model.kt';
  const CODE = [
    'package p',
    '',
    '@Serializable',
    'data class AdSizeModel(val width: Int, val height: Int)',
    '',
    'fun creer(json: String) = Json.decodeFromString<AdSizeModel>(json)',
    '',
  ].join('\n');
  let provider: UnusedDtoFieldProvider;

  beforeEach(() => {
    provider = new UnusedDtoFieldProvider();
    const f = findUnusedDtoFields({ sources: [{ path: PATH, text: CODE }], testSourceSets: [] });
    expect(f.map(x => x.name)).toEqual(['width', 'height']);
    provider.setFindings(f);
  });
  afterEach(() => provider.dispose());

  it('l\'ampoule agit sur le champ pointé', () => {
    const ligne = CODE.split('\n').findIndex(l => l.includes('data class'));
    const colWidth = CODE.split('\n')[ligne].indexOf('width');
    const colHeight = CODE.split('\n')[ligne].indexOf('height');

    const surWidth = provider.provideCodeActions(doc(PATH, CODE), { start: { line: ligne, character: colWidth }, end: { line: ligne, character: colWidth } } as any);
    const surHeight = provider.provideCodeActions(doc(PATH, CODE), { start: { line: ligne, character: colHeight }, end: { line: ligne, character: colHeight } } as any);

    expect(surWidth[0]?.title).toContain('width');
    // Avant : le premier finding de la ligne gagnait, donc pointer `height`
    // proposait de supprimer `width`, et l'edition portait sur son texte.
    expect(surHeight[0]?.title).toContain('height');
    const plages = plagesDe(surHeight[0]);
    expect(plages.length).toBe(1);
    expect(plages[0][0]).toBeGreaterThan(colWidth);
  });
});

describe('Deux entrées d\'enum mortes sur la même ligne', () => {
  const PATH = '/w/app/src/main/kotlin/Type.kt';
  const CODE = [
    'package p',
    '',
    'enum class Type { PAGE, SUB_PAGE }',
    '',
    'fun lire(t: Type) = t.name',
    '',
  ].join('\n');
  let provider: UnusedEnumEntryProvider;

  beforeEach(() => {
    provider = new UnusedEnumEntryProvider();
    const f = findUnusedEnumEntries({ sources: [{ path: PATH, text: CODE }], testSourceSets: [] });
    expect(f.map(x => x.name)).toEqual(['PAGE', 'SUB_PAGE']);
    provider.setFindings(f);
  });
  afterEach(() => provider.dispose());

  it('l\'ampoule agit sur l\'entrée pointée', () => {
    const ligne = CODE.split('\n').findIndex(l => l.includes('enum class'));
    const colSub = CODE.split('\n')[ligne].indexOf('SUB_PAGE');
    const actions = provider.provideCodeActions(doc(PATH, CODE), { start: { line: ligne, character: colSub }, end: { line: ligne, character: colSub } } as any);
    // Le detecteur ne sait pas retirer une entree d'un enum ecrit sur une
    // seule ligne (`removeStart` vaut -1 pour les deux), donc aucune
    // suppression n'est offerte, avant comme apres. Ce que le correctif
    // garantit ici, c'est que l'entree retenue est celle du curseur : la
    // regle est la meme que pour les champs DTO, ou l'effet est visible.
    expect(actions.some(a => a.title.startsWith('Delete'))).toBe(false);
    expect(findingAt(
      findUnusedEnumEntries({ sources: [{ path: PATH, text: CODE }], testSourceSets: [] }),
      { line: ligne, character: colSub },
    )!.name).toBe('SUB_PAGE');
  });
});

describe('findingAt', () => {
  const f = (name: string, line: number, character: number) => ({ name, line, character });

  it('choisit le finding dont le nom couvre la colonne', () => {
    const l = [f('width', 3, 27), f('height', 3, 43)];
    expect(findingAt(l, { line: 3, character: 45 })!.name).toBe('height');
    expect(findingAt(l, { line: 3, character: 27 })!.name).toBe('width');
  });

  it('retombe sur le plus proche quand le curseur est entre les deux', () => {
    const l = [f('width', 3, 27), f('height', 3, 43)];
    expect(findingAt(l, { line: 3, character: 40 })!.name).toBe('height');
    expect(findingAt(l, { line: 3, character: 34 })!.name).toBe('width');
  });

  it('rend le seul finding de la ligne, et rien hors ligne', () => {
    const l = [f('seul', 5, 10)];
    expect(findingAt(l, { line: 5, character: 0 })!.name).toBe('seul');
    expect(findingAt(l, { line: 6, character: 10 })).toBeUndefined();
    expect(findingAt([], { line: 5, character: 0 })).toBeUndefined();
    expect(findingAt(undefined, { line: 5, character: 0 })).toBeUndefined();
  });
});
