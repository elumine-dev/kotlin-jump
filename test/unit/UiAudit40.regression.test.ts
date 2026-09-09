import { describe, it, expect, afterEach } from 'vitest';
import { Position, workspace } from './__mocks__/vscode';
import { inRawStringTemplate } from '../../src/util/textUtils';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { SealedWhenCoverageProvider } from '../../src/providers/SealedWhenCoverageProvider';
import { StateProvenanceProvider } from '../../src/providers/StateProvenanceProvider';
import { KotlinSemanticTokensProvider } from '../../src/providers/SemanticTokensProvider';

// Audit 40 : six lignes livrées depuis la 1.42.50 qu'aucun test ne défendait.
// Trouvées en mutant les lignes réellement livrées (git diff v1.42.50..HEAD)
// et en gardant celles qui survivaient à la suite complète. Le code est juste,
// c'est la suite qui était aveugle : une régression sur ces lignes passait.

const P = (l: number, c: number) => new Position(l, c);
function doc(texte: string, version = 1, uri = 'file:///a40/A.kt'): any {
  const lignes = texte.split('\n');
  return {
    uri: { toString: () => uri, path: uri.slice(7), fsPath: uri.slice(7) },
    fileName: 'A.kt', languageId: 'kotlin', version, isDirty: false,
    getText: () => texte, lineCount: lignes.length,
    lineAt: (n: number) => { const t = lignes[n] ?? ''; return { text: t, range: { start: P(n, 0), end: P(n, t.length) } }; },
  };
}

describe('inRawStringTemplate : le texte brut ne compte pas les accolades', () => {
  it('une accolade écrite dans le texte ne fait pas croire à une interpolation', () => {
    // Motif réel : `"padding": "{5,10,15,20}"` dans un JSON de test LaPresse.
    const l = '            "padding": "{5,10,15,20}", suite';
    expect(inRawStringTemplate(l, l.indexOf('suite'))).toBe(false);
    // Une vraie interpolation sur la même ligne reste reconnue.
    const m = '            "padding": "{5,10}", ${nom} fin';
    expect(inRawStringTemplate(m, m.indexOf('nom'))).toBe(true);
    expect(inRawStringTemplate(m, m.indexOf('fin'))).toBe(false);
  });

  it('du JS injecté garde son interpolation malgré les apostrophes', () => {
    // Ligne réelle de LaPresse (NGAdViewAdGlif.kt) : les apostrophes du JS
    // ouvrent des littéraux, et l'interpolation est écrite dans l'un d'eux.
    const l = "document.documentElement.style.setProperty('--safe-area-inset-bottom', '${insetBottom}px');";
    expect(inRawStringTemplate(l, l.indexOf('insetBottom'))).toBe(true);
    // Le nom de la propriété CSS, lui, reste du texte.
    expect(inRawStringTemplate(l, l.indexOf('safe'))).toBe(false);
  });

  it('une accolade à l\'intérieur d\'un littéral de l\'interpolation ne déséquilibre rien', () => {
    const l = 'prefixe ${ "a{b" } texte';
    // L'accolade est dans le littéral : elle n'ouvre pas un niveau de plus,
    // donc `texte`, écrit après la fermeture, reste du texte.
    expect(inRawStringTemplate(l, l.indexOf('texte'))).toBe(false);
    expect(inRawStringTemplate(l, l.indexOf('a{b'))).toBe(false);
  });

  it('un littéral de longueur impaire se referme quand même', () => {
    // Sauter un caractère sur deux dans le littéral ferait rater le guillemet
    // fermant et éteindrait le reste de l'interpolation.
    const l = 'prefixe ${ "abc" + nom } fin';
    expect(inRawStringTemplate(l, l.indexOf('nom'))).toBe(true);
    expect(inRawStringTemplate(l, l.indexOf('abc'))).toBe(false);
    expect(inRawStringTemplate(l, l.indexOf('fin'))).toBe(false);
  });
});

describe('Les caches par document servent bien la même réponse', () => {
  const KT = [
    'package com.example',
    '',
    'sealed class Etat',
    'object Pret : Etat()',
    'object Charge : Etat()',
    '',
    'fun rendre(e: Etat) = when (e) {',
    '    is Pret -> 1',
    '}',
  ].join('\n');

  it('SealedWhenCoverage rend le tableau mémorisé, pas un recalcul', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///a40/A.kt', KT));
    index.finalize();
    const p = new SealedWhenCoverageProvider(index);
    const d = doc(KT);
    const premier = p.provideCodeLenses(d);
    const second = p.provideCodeLenses(d);
    // Même document, même version, même texte : la seconde réponse est la
    // première, pas une copie recalculée.
    expect(second).toBe(premier);
  });

  it('StateProvenance rend le tableau mémorisé, pas un recalcul', () => {
    const VM = [
      'package com.example',
      '',
      'class MonViewModel {',
      '    private val _etat = MutableStateFlow(0)',
      '    val etat: StateFlow<Int> = _etat',
      '',
      '    fun charger() { _etat.value = 1 }',
      '}',
    ].join('\n');
    const index = new SymbolIndex();
    index.add(parse('file:///a40/VM.kt', VM));
    index.finalize();
    const p = new StateProvenanceProvider(index);
    const d = doc(VM, 1, 'file:///a40/VM.kt');
    const premier = p.provideCodeLenses(d);
    const second = p.provideCodeLenses(d);
    expect(second).toBe(premier);
  });
});

describe('Coloration sémantique éteinte par le réglage', () => {
  const origConfig = workspace.getConfiguration;
  afterEach(() => { workspace.getConfiguration = origConfig; });

  it('le résultat vide est mémorisé sous la clé du document', () => {
    workspace.getConfiguration = (() => ({
      get: (cle: string, defaut: any) => (cle === 'semanticHighlighting' ? false : defaut),
      update: async () => {},
    })) as any;
    const index = new SymbolIndex();
    index.add(parse('file:///a40/A.kt', 'package p\nclass A'));
    index.finalize();
    const p = new KotlinSemanticTokensProvider(index, { tokenTypes: [], tokenModifiers: [] } as any);
    const d = doc('package p\nclass A');
    const a = p.provideDocumentSemanticTokens(d, { isCancellationRequested: false } as any);
    const b = p.provideDocumentSemanticTokens(d, { isCancellationRequested: false } as any);
    expect(a.data.length).toBe(0);
    // Sans mise en cache, chaque appel forgerait un nouvel identifiant et les
    // deltas repartiraient de zéro à chaque frappe.
    expect(b.resultId).toBe(a.resultId);
  });
});
