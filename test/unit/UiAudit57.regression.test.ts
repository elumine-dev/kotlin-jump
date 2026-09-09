import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { OverrideGutterProvider } from '../../src/providers/OverrideGutterProvider';
import { Range, workspace } from './__mocks__/vscode';

// Audit 57 : la v1.42.77 a fait passer le COMPTE du lens à la marche
// transitive et a laissé toutes les LISTES sur les supertypes directs. Sur
// LaPresse, 133 types class-like sur 6423 affichaient un nombre que la liste
// ouverte au clic ne pouvait pas montrer, dans les deux sens : le lens
// principal annonçait 10 sous types scellés là où la liste en montrait 2, et
// `DispatcherModule` annonçait 0 là où la liste en montrait 1 de trop, prise à
// un homonyme d'un autre package.
//
// Les deux lenses vivent sur la MÊME ligne : le lens principal
// « N usages | M implementations » et le lens ⬇ d'OverrideGutterProvider.

const IFACE = 'file:///a57/Bindable.kt';
const BASE  = 'file:///a57/Base.kt';
const CONCR = 'file:///a57/Concrete.kt';
const CODE: Record<string, string> = {
  [IFACE]: 'package p\n\ninterface Bindable {\n    fun bind()\n}\n',
  [BASE]:  'package p\n\nabstract class Base : Bindable {\n    override fun bind() {}\n}\n',
  [CONCR]: 'package p\n\nclass Concrete : Base() {\n    override fun bind() {}\n}\n',
};

function indexDe(codes: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(codes)) index.add(parse(uri, code));
  index.finalize();
  return index;
}

describe('Le compte du lens et la liste ouverte au clic disent la même chose', () => {
  let index: SymbolIndex;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = indexDe(CODE);
    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(CODE[uri.toString ? uri.toString() : String(uri)] ?? '') as any;
  });
  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('le lens principal, le lens ⬇ et la liste comptent tous 2', async () => {
    const entry = index.lookup('Bindable').find(e => e.kind === 'interface')!;

    const codeLens = new KotlinCodeLensProvider(index);
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;
    const resolu = await codeLens.resolveCodeLens(lens, { isCancellationRequested: false } as any);
    expect(resolu!.command!.title).toContain('2 implementations');

    const gutter = new OverrideGutterProvider(index);
    const doc = { languageId: 'kotlin', uri: { toString: () => IFACE, fsPath: '/a57/Bindable.kt' } } as any;
    // Sur la ligne de l'INTERFACE, pas celle de la méthode : le lens de `bind`
    // passe déjà par lookupMethodImplementations, qui marche la chaîne depuis
    // la v1.42.77, et affiche 2 quoi qu'il arrive.
    const surLaDecl = gutter.provideCodeLenses(doc)
      .filter(l => l.range.start.line === entry.line)
      .map(l => l.command!.title);
    expect(surLaDecl).toEqual(['⬇ 2 implementations']);

    expect(index.implementationsOfName('Bindable').map(e => e.name).sort())
      .toEqual(['Base', 'Concrete']);
  });

  it('un homonyme d\'un autre package ne rentre pas dans la liste', () => {
    // `Autre` est dans un troisième package et importe com.b.Handler.
    // L'ancienne heuristique par package le créditait AUSSI à com.a.Handler,
    // parce qu'aucun Handler n'est déclaré dans le package d'Autre.
    const idx = indexDe({
      'file:///a57/aHandler.kt': 'package com.a\ninterface Handler\n',
      'file:///a57/bHandler.kt': 'package com.b\ninterface Handler\n',
      'file:///a57/Autre.kt': 'package com.c\n\nimport com.b.Handler\n\nclass Autre : Handler\n',
    });
    expect(idx.implementationsOfName('Handler', 'com.a')).toEqual([]);
    expect(idx.implementationsOfName('Handler', 'com.b').map(e => e.name)).toEqual(['Autre']);
  });

  it('sans package donné, la liste réunit les homonymes sans doublon', () => {
    const idx = indexDe({
      'file:///a57/aHandler.kt': 'package com.a\ninterface Handler\n',
      'file:///a57/aImpl.kt': 'package com.a\nclass AImpl : Handler\n',
      'file:///a57/bHandler.kt': 'package com.b\ninterface Handler\n',
      'file:///a57/bImpl.kt': 'package com.b\nclass BImpl : Handler\n',
    });
    expect(idx.implementationsOfName('Handler').map(e => e.name).sort()).toEqual(['AImpl', 'BImpl']);
  });

  it('la liste suit la chaîne, pas seulement le premier niveau', () => {
    expect(index.implementationsOfName('Bindable', 'p').map(e => e.name).sort())
      .toEqual(['Base', 'Concrete']);
  });
});

describe('Le compte ne compte pas ce que la liste refuse de montrer', () => {
  const MAIN_IFACE = 'file:///a57b/src/main/kotlin/Repo.kt';
  const MAIN_IMPL  = 'file:///a57b/src/main/kotlin/RealRepo.kt';
  const TEST_IMPL  = 'file:///a57b/src/test/kotlin/FakeRepo.kt';
  const CODES: Record<string, string> = {
    [MAIN_IFACE]: 'package p\n\ninterface Repo {\n    fun get()\n}\n',
    [MAIN_IMPL]:  'package p\n\nclass RealRepo : Repo {\n    override fun get() {}\n}\n',
    [TEST_IMPL]:  'package p\n\nclass FakeRepo : Repo {\n    override fun get() {}\n}\n',
  };

  let origReadFile: typeof workspace.fs.readFile;
  let origCfg: typeof workspace.getConfiguration;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    origCfg = workspace.getConfiguration;
    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(CODES[uri.toString ? uri.toString() : String(uri)] ?? '') as any;
    workspace.getConfiguration = (() => ({
      get: (key: string, defaultVal: any) => (key === 'testSourceSets' ? ['test/kotlin'] : defaultVal),
      update: async () => {},
    })) as any;
  });
  afterEach(() => {
    workspace.fs.readFile = origReadFile;
    workspace.getConfiguration = origCfg;
  });

  it('depuis un fichier de production, un double de test ne gonfle plus le compte', async () => {
    const index = indexDe(CODES);
    const entry = index.lookup('Repo').find(e => e.kind === 'interface')!;

    // La marche brute en voit deux ; ce que le lens annonce doit correspondre
    // a ce que la liste ouverte au clic accepte de montrer, soit RealRepo seul.
    expect(index.lookupImplementationsDeep(entry)).toHaveLength(2);

    const codeLens = new KotlinCodeLensProvider(index);
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;
    const resolu = await codeLens.resolveCodeLens(lens, { isCancellationRequested: false } as any);
    expect(resolu!.command!.title).toContain('1 implementation');
    expect(resolu!.command!.title).not.toContain('2 implementations');
  });
});
