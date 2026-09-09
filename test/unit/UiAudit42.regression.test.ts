import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parseJava } from '../../src/indexer/JavaParser';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';
import { mockDocument, positionOf } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 42 : la hiérarchie d'appels écarte la ligne de déclaration d'une
// surcharge avec une expression qui ne connaît que `fun nom(`. En Java une
// déclaration s'écrit `protected void nom(`, donc elle passait pour un appel
// et la surcharge apparaissait comme appelante d'elle-même. Motif réel :
// LaPresse, LiveNewsModelV4AssemblerTest.java, trois `initDagger` surchargés.

const URI = 'file:///a42/Base.java';
const CODE = [
  'package com.example;',
  '',
  'class Base {',
  '    protected void initDagger(Context context) {}',
  '',
  '    protected void initDagger(Context context, boolean flag) {}',
  '',
  '    void demarrer() {',
  '        initDagger(null);',
  '    }',
  '}',
].join('\n');

function noCancel() { return { isCancellationRequested: false } as any; }

describe('Hiérarchie d\'appels sur une surcharge Java', () => {
  let index: SymbolIndex;
  let provider: KotlinCallHierarchyProvider;
  let origOpen: typeof workspace.openTextDocument;
  let origRead: typeof workspace.fs.readFile;

  beforeEach(() => {
    origOpen = workspace.openTextDocument;
    origRead = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parseJava(URI, CODE));
    index.finalize();
    provider = new KotlinCallHierarchyProvider(index);
    workspace.openTextDocument = (async () => mockDocument(URI, CODE)) as any;
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
  });

  afterEach(() => {
    workspace.openTextDocument = origOpen;
    workspace.fs.readFile = origRead;
  });

  it('la surcharge sœur n\'est pas un appelant', async () => {
    const doc = mockDocument(URI, CODE);
    const items = provider.prepareCallHierarchy(doc, positionOf(CODE, 'initDagger'));
    expect(items && items.length).toBeTruthy();
    const entrants = await provider.provideCallHierarchyIncomingCalls(items![0], noCancel());
    const noms = entrants.map(e => e.from.name).sort();
    // Seul `demarrer` appelle vraiment. La ligne `protected void initDagger(
    // Context context, boolean flag)` est une déclaration, pas un appel.
    expect(noms).toEqual(['demarrer']);
  });

  it('un appel réel depuis une autre méthode reste visible', async () => {
    const doc = mockDocument(URI, CODE);
    const items = provider.prepareCallHierarchy(doc, positionOf(CODE, 'initDagger'));
    const entrants = await provider.provideCallHierarchyIncomingCalls(items![0], noCancel());
    const depuisDemarrer = entrants.find(e => e.from.name === 'demarrer');
    expect(depuisDemarrer).toBeDefined();
    expect(depuisDemarrer!.fromRanges.length).toBe(1);
  });
});

describe('Hiérarchie d\'appels sur une surcharge Kotlin', () => {
  const KT_URI = 'file:///a42/Base.kt';
  const KT = [
    'package com.example',
    '',
    'class Base {',
    '    fun charger(id: Int) {}',
    '',
    '    fun charger(nom: String) {}',
    '',
    '    fun demarrer() {',
    '        charger(1)',
    '    }',
    '}',
  ].join('\n');
  let origOpen: typeof workspace.openTextDocument;
  let origRead: typeof workspace.fs.readFile;
  let provider: KotlinCallHierarchyProvider;

  beforeEach(() => {
    origOpen = workspace.openTextDocument;
    origRead = workspace.fs.readFile;
    const index = new SymbolIndex();
    index.add(parse(KT_URI, KT));
    index.finalize();
    provider = new KotlinCallHierarchyProvider(index);
    workspace.openTextDocument = (async () => mockDocument(KT_URI, KT)) as any;
    workspace.fs.readFile = (async () => Buffer.from(KT)) as any;
  });
  afterEach(() => {
    workspace.openTextDocument = origOpen;
    workspace.fs.readFile = origRead;
  });

  it('la surcharge sœur n\'est pas un appelant non plus', async () => {
    const doc = mockDocument(KT_URI, KT);
    const items = provider.prepareCallHierarchy(doc, positionOf(KT, 'charger'));
    const entrants = await provider.provideCallHierarchyIncomingCalls(items![0], noCancel());
    expect(entrants.map(e => e.from.name).sort()).toEqual(['demarrer']);
  });
});
