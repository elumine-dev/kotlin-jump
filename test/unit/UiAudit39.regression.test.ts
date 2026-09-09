import { describe, it, expect, beforeEach } from 'vitest';
import { scanForUsagesWithTarget, clearContentCache } from '../../src/providers/FindUsagesEngine';
import { KotlinDocumentHighlightProvider } from '../../src/providers/DocumentHighlightProvider';
import { inRawStringTemplate } from '../../src/util/textUtils';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 39 : suite de l'audit 38. En partageant `inRawStringTemplate` entre le
// surlignage et Find Usages, la comparaison des deux vues sur le corpus réel a
// dénoncé le moteur, pas le surlignage : à l'intérieur d'une interpolation on
// est en code, donc un littéral imbriqué est du texte à nouveau. Find Usages
// comptait le libellé, et comme Rename passe par le même scan, un renommage
// réécrivait ce texte. Cas réel : LaPresse, EditionStatus.kt, le toString
// `${if (downloadedDate == null) "" else ", downloadedDate=$downloadedDate"}`.

const URI = 'file:///com/example/EditionStatus.kt';
const CODE = [
  'package com.example',
  '',
  'class EditionStatus {',
  '    private val downloadedDate: String? = null',
  '',
  '    override fun toString(): String {',
  '        return """',
  '            |status${if (downloadedDate == null) "" else ", downloadedDate=$downloadedDate"}',
  '        """.trimMargin()',
  '    }',
  '}',
].join('\n');

const LIGNE_TOSTRING = CODE.split('\n').findIndex(l => l.includes('|status'));

describe('Un littéral imbriqué dans une interpolation redevient du texte', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
  });

  it('inRawStringTemplate distingue les trois positions de la même ligne', () => {
    const l = CODE.split('\n')[LIGNE_TOSTRING];
    const dansCondition = l.indexOf('downloadedDate');
    const dansLibelle = l.indexOf('downloadedDate', l.indexOf('else'));
    const apresDollar = l.indexOf('$downloadedDate') + 1;

    // Le test de la condition est du code.
    expect(inRawStringTemplate(l, dansCondition)).toBe(true);
    // Le libellé écrit dans le littéral imbriqué est du texte.
    expect(inRawStringTemplate(l, dansLibelle)).toBe(false);
    // Une interpolation à l'intérieur de ce littéral reste du code.
    expect(inRawStringTemplate(l, apresDollar)).toBe(true);
  });

  it('Find Usages ne compte pas le libellé, et Rename ne le réécrirait donc pas', async () => {
    const origRead = workspace.fs.readFile;
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
    try {
      const cible = index.lookup('downloadedDate')[0];
      expect(cible).toBeDefined();
      const usages = await scanForUsagesWithTarget(
        'downloadedDate', cible, index, [URI],
        { isCancellationRequested: false } as any,
      );
      const l = CODE.split('\n')[LIGNE_TOSTRING];
      const surLaLigne = usages.filter(u => u.line === LIGNE_TOSTRING).map(u => u.character).sort((a, b) => a - b);
      expect(surLaLigne).toEqual([
        l.indexOf('downloadedDate'),
        l.indexOf('$downloadedDate') + 1,
      ]);
      expect(surLaLigne).not.toContain(l.indexOf('downloadedDate', l.indexOf('else')));
    } finally {
      workspace.fs.readFile = origRead;
      clearContentCache();
    }
  });

  it('le surlignage rend exactement les mêmes positions que Find Usages', async () => {
    const origRead = workspace.fs.readFile;
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
    try {
      const doc = mockDocument(URI, CODE);
      const decl = CODE.split('\n').findIndex(l => l.includes('private val downloadedDate'));
      const pos = { line: decl, character: CODE.split('\n')[decl].indexOf('downloadedDate') } as any;
      const provider = new KotlinDocumentHighlightProvider(index);
      const surlignes = (provider.provideDocumentHighlights(doc, pos, { isCancellationRequested: false } as any) ?? [])
        .filter(h => h.range.start.line === LIGNE_TOSTRING)
        .map(h => h.range.start.character).sort((a, b) => a - b);

      const usages = (await scanForUsagesWithTarget(
        'downloadedDate', index.lookup('downloadedDate')[0], index, [URI],
        { isCancellationRequested: false } as any,
      )).filter(u => u.line === LIGNE_TOSTRING).map(u => u.character).sort((a, b) => a - b);

      expect(surlignes).toEqual(usages);
      expect(surlignes.length).toBe(2);
    } finally {
      workspace.fs.readFile = origRead;
      clearContentCache();
    }
  });
});
