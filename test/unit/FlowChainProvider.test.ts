/**
 * FlowChainProvider — badges numérotés sur les pipelines multi-lignes
 *
 * Vecteurs :
 *   FC-1  Chaîne 3 étapes → ①②③ aux bonnes lignes, colonne = début du `.`
 *   FC-2  Chaîne 1 étape → aucun badge (le point de la feature = longues chaînes)
 *   FC-3  Lambda multi-ligne au milieu → la numérotation continue
 *   FC-4  Deux chaînes séparées → la numérotation redémarre à ①
 *   FC-5  Opérateur inconnu en début de ligne → casse la chaîne
 *   FC-6  Accolades dans strings et commentaires du lambda → depth correct
 *   FC-7  Raw string multi-ligne dans le lambda → depth non corrompu
 *   FC-8  Commentaires et lignes vides entre étapes → neutres
 *   FC-9  Chaîne inline sur une seule ligne → aucun badge
 *   FC-10 21+ étapes → bascule sur (21) après ⑳
 *   FC-11 Java → aucun badge
 *   FC-12 Chaîne imbriquée dans launch { } → fermeture ne casse pas les badges
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { FlowChainProvider } from '../../src/providers/FlowChainProvider';

function makeDoc(lines: string[], languageId = 'kotlin'): vscode.TextDocument {
  return {
    languageId,
    lineCount: lines.length,
    lineAt: (n: number) => ({ text: lines[n] }),
  } as unknown as vscode.TextDocument;
}

function hintsFor(lines: string[], languageId = 'kotlin'): vscode.InlayHint[] {
  const provider = new FlowChainProvider();
  const range = new vscode.Range(0, 0, lines.length - 1, 0) as any;
  return provider.provideInlayHints(makeDoc(lines, languageId), range);
}

function labels(hints: vscode.InlayHint[]): string[] {
  return hints.map(h => String(h.label));
}

describe('FC-1 — chaîne de base', () => {
  const lines = [
    'flow',
    '    .map { it.name }',
    '    .filter { it != "" }',
    '    .collect { render(it) }',
  ];

  it('badges ①②③', () => {
    expect(labels(hintsFor(lines))).toEqual(['①', '②', '③']);
  });

  it('lignes et colonnes exactes', () => {
    const h = hintsFor(lines);
    expect(h.map(x => x.position.line)).toEqual([1, 2, 3]);
    expect(h.map(x => x.position.character)).toEqual([4, 4, 4]);
  });
});

describe('FC-2 — chaîne trop courte', () => {
  it('un seul opérateur → rien', () => {
    expect(hintsFor(['items', '    .forEach { print(it) }'])).toHaveLength(0);
  });
});

describe('FC-3 — lambda multi-ligne', () => {
  it('la numérotation traverse le corps du lambda', () => {
    const h = hintsFor([
      'flow',
      '    .map {',
      '        heavyTransform(it)',
      '    }',
      '    .filter { it.isValid }',
      '    .collect { render(it) }',
    ]);
    expect(labels(h)).toEqual(['①', '②', '③']);
    expect(h.map(x => x.position.line)).toEqual([1, 4, 5]);
  });
});

describe('FC-4 — chaînes indépendantes', () => {
  it('deux pipelines → chacun redémarre à ①', () => {
    const h = hintsFor([
      'a', '    .map { it }', '    .toList()',
      'b', '    .filter { it }', '    .first()',
    ]);
    expect(labels(h)).toEqual(['①', '②', '①', '②']);
  });
});

describe('FC-5 — opérateur inconnu', () => {
  it('.build() casse la chaîne, 2 étapes restantes badgées', () => {
    const h = hintsFor([
      'x', '    .map { it }', '    .toList()', '    .build()',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
  });

  it('chaîne de builder pur → rien', () => {
    expect(hintsFor(['x', '    .setName("a")', '    .setAge(3)', '    .build()'])).toHaveLength(0);
  });
});

describe('FC-6 — accolades piégées', () => {
  it('accolade dans une string du lambda → depth correct', () => {
    const h = hintsFor([
      'flow',
      '    .map {',
      '        val s = "closing } brace {"',
      '    }',
      '    .collect { }',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
  });

  it('accolade dans un commentaire du lambda → depth correct', () => {
    const h = hintsFor([
      'flow',
      '    .map {',
      '        f(it) // spare } here',
      '    }',
      '    .collect { }',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
  });
});

describe('FC-7 — raw string dans le lambda', () => {
  it('les accolades du contenu """ ne comptent pas', () => {
    const h = hintsFor([
      'flow',
      '    .map {',
      '        val q = """',
      '            { } } } {',
      '        """',
      '        q',
      '    }',
      '    .collect { }',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
  });
});

describe('FC-8 — lignes neutres', () => {
  it('commentaire et ligne vide entre deux étapes', () => {
    const h = hintsFor([
      'flow',
      '    .map { it }',
      '    // keep only valid entries',
      '',
      '    .filter { it.isValid }',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
  });
});

describe('FC-9 — chaîne inline', () => {
  it('list.map{}.filter{} sur une ligne → rien', () => {
    expect(hintsFor(['val r = list.map { it }.filter { it > 0 }'])).toHaveLength(0);
  });
});

describe('FC-10 — au delà de ⑳', () => {
  it('21 étapes → le 21e badge est (21)', () => {
    const lines = ['flow', ...Array.from({ length: 21 }, () => '    .map { it }')];
    const h = hintsFor(lines);
    expect(h).toHaveLength(21);
    expect(String(h[19].label)).toBe('⑳');
    expect(String(h[20].label)).toBe('(21)');
  });
});

describe('FC-11 — java exclu', () => {
  it('stream java → rien', () => {
    expect(hintsFor(['x', '    .map(y -> y)', '    .filter(y -> true)'], 'java')).toHaveLength(0);
  });
});

describe('FC-12 — chaîne dans un bloc englobant', () => {
  it('la fermeture du launch ne mange pas les badges', () => {
    const h = hintsFor([
      'scope.launch {',
      '    flow',
      '        .map { it }',
      '        .collect { render(it) }',
      '}',
    ]);
    expect(labels(h)).toEqual(['①', '②']);
    expect(h.map(x => x.position.line)).toEqual([2, 3]);
  });
});
