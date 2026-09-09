import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FindUsagesPanel } from '../../src/providers/FindUsagesPanel';
import { clearContentCache } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 46 : le panneau Find Usages retire depuis la 1.42.61 toutes les
// déclarations du symbole, pas seulement celle sous le curseur. Aucun test
// n'exerçait ce chemin : `DeclExclusion.test.ts` réimplémente le filtre au
// lieu d'appeler `search()`, et sa copie est restée sur l'ancienne règle.
// Muter le filtre du FQN dans le panneau ne cassait donc aucun test.

const DECL_URI = 'file:///a46/Charge.kt';
const APPEL_URI = 'file:///a46/Appel.kt';
const DECL = [
  'package com.example',
  '',
  'class Charge {',
  '    fun charger(id: Int) {}',
  '',
  '    fun charger(nom: String) {}',
  '}',
].join('\n');
const APPEL = 'package com.example\n\nfun demarrer(c: Charge) {\n    c.charger(1)\n}\n';

describe('Le panneau Find Usages ne liste aucune déclaration', () => {
  let panel: FindUsagesPanel;
  const origRead = workspace.fs.readFile;

  beforeEach(() => {
    const index = new SymbolIndex();
    index.add(parse(DECL_URI, DECL));
    index.add(parse(APPEL_URI, APPEL));
    index.finalize();
    panel = new FindUsagesPanel(index);
    panel.attachTreeView({ message: undefined, description: undefined } as any);
    workspace.fs.readFile = (async (u: any) => {
      const s = typeof u.toString === 'function' ? u.toString() : String(u);
      return Buffer.from(s === APPEL_URI ? APPEL : s === DECL_URI ? DECL : '');
    }) as any;
  });

  afterEach(() => {
    workspace.fs.readFile = origRead;
    clearContentCache();
    panel.dispose();
  });

  it('la déclaration de la surcharge sœur n\'apparaît pas dans la liste', async () => {
    const doc = mockDocument(DECL_URI, DECL);
    const ligne = DECL.split('\n').findIndex(l => l.includes('fun charger(id: Int)'));
    const pos = { line: ligne, character: DECL.split('\n')[ligne].indexOf('charger') } as any;

    await panel.search(doc, pos);

    const fichiers = panel.getChildren();
    const positions = fichiers.flatMap(f => panel.getChildren(f).map((u: any) => `${f.uri.toString()}:${u.line}`));
    // Seul l'appel réel est listé. Les deux lignes `fun charger` sont des
    // déclarations, pas des usages.
    expect(positions).toEqual([`${APPEL_URI}:3`]);
  });

  it('le compte affiché correspond à ce que la liste contient', async () => {
    const doc = mockDocument(DECL_URI, DECL);
    const ligne = DECL.split('\n').findIndex(l => l.includes('fun charger(nom: String)'));
    const pos = { line: ligne, character: DECL.split('\n')[ligne].indexOf('charger') } as any;

    await panel.search(doc, pos);
    const fichiers = panel.getChildren();
    const total = fichiers.reduce((n, f) => n + panel.getChildren(f).length, 0);
    expect(total).toBe(1);
  });
});
