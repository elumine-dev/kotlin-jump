import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KotlinDocumentHighlightProvider } from '../../src/providers/DocumentHighlightProvider';
import { scanForUsagesWithTarget, clearContentCache } from '../../src/providers/FindUsagesEngine';
import { inRawStringTemplate } from '../../src/util/textUtils';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 38 : dans une chaîne brute, le surlignage d'occurrences allumait
// `$name` mais pas `${name}`, alors que Find Usages comptait les deux. Le
// même fichier répondait donc deux choses différentes sur la même position.
// Cas réel : LaPresse, PhotoCaptionOverlayConstraintLayout.kt, `ev.y:${ev.y}`
// dans une chaîne triple, où l'occurrence de code restait éteinte.

const URI = 'file:///com/example/Raw.kt';
const CODE = [
  'package com.example',
  '',
  'class Probe {',
  '    private val ev: String = "tap"',
  '',
  '    fun dump(): String {',
  '        return """',
  '            ev short: $ev',
  '            ev braced: ${ev.length}',
  '            ev plain text, not code',
  '        """',
  '    }',
  '}',
].join('\n');

const ligneDe = (aiguille: string) => CODE.split('\n').findIndex(l => l.includes(aiguille));

describe('Chaîne brute : `${x}` est du code autant que `$x`', () => {
  let provider: KotlinDocumentHighlightProvider;
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('surligne les deux formes d\'interpolation et laisse le texte brut éteint', () => {
    const doc = mockDocument(URI, CODE);
    const decl = ligneDe('private val ev');
    const pos = { line: decl, character: CODE.split('\n')[decl].indexOf('ev') } as any;
    const hits = provider.provideDocumentHighlights(doc, pos, { isCancellationRequested: false } as any) ?? [];

    const lShort = ligneDe('ev short');
    const lBraced = ligneDe('ev braced');
    const lPlain = ligneDe('ev plain text');
    const colonnes = (l: number) => hits.filter(h => h.range.start.line === l).map(h => h.range.start.character).sort((a, b) => a - b);

    // `$ev` : déjà surligné avant le correctif.
    expect(colonnes(lShort)).toEqual([CODE.split('\n')[lShort].indexOf('$ev') + 1]);
    // `${ev.length}` : c'est le cas que le correctif rattrape. Le `ev` du
    // libellé « ev braced: » est du texte brut et doit rester éteint.
    expect(colonnes(lBraced)).toEqual([CODE.split('\n')[lBraced].indexOf('${ev') + 2]);
    // Une ligne sans aucune interpolation ne s'allume nulle part.
    expect(colonnes(lPlain)).toEqual([]);
  });

  it('le surlignage et Find Usages désignent les mêmes positions dans le fichier', async () => {
    const origRead = workspace.fs.readFile;
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
    try {
      const doc = mockDocument(URI, CODE);
      const decl = ligneDe('private val ev');
      const pos = { line: decl, character: CODE.split('\n')[decl].indexOf('ev') } as any;
      const surlignes = (provider.provideDocumentHighlights(doc, pos, { isCancellationRequested: false } as any) ?? [])
        .map(h => `${h.range.start.line}:${h.range.start.character}`);

      const usages = await scanForUsagesWithTarget(
        'ev', index.lookup('ev')[0], index, [URI],
        { isCancellationRequested: false } as any,
      );
      const trouves = usages.filter(u => u.uriString === URI).map(u => `${u.line}:${u.character}`);

      // Les deux vues sont d'accord sur les positions de la chaîne brute.
      const dansBrute = (s: string[]) => s.filter(p => {
        const l = Number(p.split(':')[0]);
        return l >= ligneDe('return """') && l <= ligneDe('        """');
      }).sort();
      expect(dansBrute(surlignes)).toEqual(dansBrute(trouves));
      expect(dansBrute(surlignes).length).toBe(2);
    } finally {
      workspace.fs.readFile = origRead;
      clearContentCache();
    }
  });

  it('inRawStringTemplate ne prend pas le texte brut pour du code', () => {
    const l = '            ev.y:${ev.y}';
    expect(inRawStringTemplate(l, l.indexOf('ev'))).toBe(false);
    expect(inRawStringTemplate(l, l.indexOf('${ev') + 2)).toBe(true);
    // Une accolade refermée rend la suite au texte brut.
    const ferme = 'a ${x} ev';
    expect(inRawStringTemplate(ferme, ferme.indexOf('ev'))).toBe(false);
  });
});
