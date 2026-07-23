/**
 * KmpExpectActualProvider — badges de couverture des targets KMP
 *
 * Vecteurs :
 *   KA-1  targetOf : androidMain/iosMain/jsMain extraits, commonMain → null,
 *         chemins non-KMP (src/main) → null
 *   KA-2  collectProjectTargets : union des sourcesets, common exclu
 *   KA-3  coverageLabel : ✓/✗, tri alphabétique stable
 *   KA-4  Provider : expect couvert partiellement → badge exact
 *   KA-5  Tous couverts → tous ✓ ; aucun actual → tous ✗
 *   KA-6  Projet non-KMP (aucun *Main) → aucun lens même sur un expect
 *   KA-7  Fichier sans expect → aucun lens
 *   KA-8  Homonymes de packages différents : l'actual d'un autre FQN ne
 *         couvre pas cet expect
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import {
  targetOf, collectProjectTargets, coverageLabel, KmpExpectActualProvider,
} from '../../src/providers/KmpExpectActualProvider';

const COMMON = 'file:///proj/shared/src/commonMain/kotlin/com/example/Platform.kt';

function makeDoc(uriStr: string): vscode.TextDocument {
  return {
    uri: { toString: () => uriStr },
    languageId: 'kotlin',
  } as unknown as vscode.TextDocument;
}

function buildIndex(actualTargets: string[]): SymbolIndex {
  const index = new SymbolIndex();
  index.add(parse(COMMON, 'package com.example\nexpect fun platformName(): String'));
  for (const t of actualTargets) {
    index.add(parse(
      `file:///proj/shared/src/${t}Main/kotlin/com/example/Platform.kt`,
      'package com.example\nactual fun platformName(): String = "x"',
    ));
  }
  return index;
}

describe('KA-1 — targetOf', () => {
  it.each([
    ['file:///p/src/androidMain/kotlin/A.kt', 'android'],
    ['file:///p/src/iosMain/kotlin/A.kt', 'ios'],
    ['file:///p/src/jsMain/kotlin/A.kt', 'js'],
    ['file:///p/src/commonMain/kotlin/A.kt', null],
    ['file:///p/app/src/main/kotlin/A.kt', null],
    ['file:///p/src/androidTest/kotlin/A.kt', null],
  ])('%s → %s', (uri, expected) => {
    expect(targetOf(uri)).toBe(expected);
  });
});

describe('KA-2 — collectProjectTargets', () => {
  it('union sans common', () => {
    const targets = collectProjectTargets([
      'file:///p/src/commonMain/A.kt',
      'file:///p/src/androidMain/A.kt',
      'file:///p/src/iosMain/B.kt',
      'file:///p/src/iosMain/C.kt',
    ]);
    expect([...targets].sort()).toEqual(['android', 'ios']);
  });
});

describe('KA-3 — coverageLabel', () => {
  it('tri alphabétique, ✓ et ✗', () => {
    expect(coverageLabel(new Set(['ios', 'android']), new Set(['js', 'android', 'ios'])))
      .toBe('[android ✓] [ios ✓] [js ✗]');
  });
});

describe('KA-4/5 — couverture', () => {
  it('partielle : android+ios couverts, js manquant', () => {
    const index = buildIndex(['android', 'ios']);
    index.add(parse('file:///proj/shared/src/jsMain/kotlin/com/example/Other.kt',
      'package com.example\nfun unrelated() {}'));
    const p = new KmpExpectActualProvider(index);
    const lenses = p.provideCodeLenses(makeDoc(COMMON));
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('[android ✓] [ios ✓] [js ✗]');
  });

  it('complète → tous ✓', () => {
    const index = buildIndex(['android', 'ios']);
    const p = new KmpExpectActualProvider(index);
    expect(p.provideCodeLenses(makeDoc(COMMON))[0].command?.title)
      .toBe('[android ✓] [ios ✓]');
  });

  it('aucun actual mais des sourcesets → tous ✗', () => {
    const index = buildIndex([]);
    index.add(parse('file:///proj/shared/src/androidMain/kotlin/com/example/Other.kt',
      'package com.example\nfun unrelated() {}'));
    const p = new KmpExpectActualProvider(index);
    expect(p.provideCodeLenses(makeDoc(COMMON))[0].command?.title).toBe('[android ✗]');
  });
});

describe('KA-6 — projet non-KMP', () => {
  it('aucun *Main → aucun lens', () => {
    const index = new SymbolIndex();
    const uri = 'file:///proj/app/src/main/kotlin/com/example/Platform.kt';
    index.add(parse(uri, 'package com.example\nexpect fun platformName(): String'));
    const p = new KmpExpectActualProvider(index);
    expect(p.provideCodeLenses(makeDoc(uri))).toHaveLength(0);
  });
});

describe('KA-7 — fichier sans expect', () => {
  it('actual seul → aucun lens', () => {
    const index = buildIndex(['android']);
    const p = new KmpExpectActualProvider(index);
    const actualUri = 'file:///proj/shared/src/androidMain/kotlin/com/example/Platform.kt';
    expect(p.provideCodeLenses(makeDoc(actualUri))).toHaveLength(0);
  });
});

describe('KA-8 — homonymes de packages différents', () => {
  it("l'actual d'un autre package ne couvre pas", () => {
    const index = buildIndex([]);
    // actual homonyme dans un AUTRE package, sur iosMain
    index.add(parse('file:///proj/shared/src/iosMain/kotlin/com/other/Platform.kt',
      'package com.other\nactual fun platformName(): String = "y"'));
    const p = new KmpExpectActualProvider(index);
    const lenses = p.provideCodeLenses(makeDoc(COMMON));
    expect(lenses[0].command?.title).toBe('[ios ✗]');
  });
});
